#!/usr/bin/env node
// Offline inspector for a built Android artifact (.apk / .aab).
// Parses the binary AndroidManifest, reports signing state, and scans every
// entry for release-blocking secrets. Requires no Android SDK.
import { readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

const target = process.argv[2]
if (!target) {
  console.error('usage: inspect-android-artifact.mjs <path-to-apk-or-aab>')
  process.exit(2)
}

/* ------------------------------ zip reading ------------------------------ */

function readZipEntries(buffer) {
  const eocdSignature = 0x06054b50
  let eocd = -1
  for (let index = buffer.length - 22; index >= 0 && index > buffer.length - 70000; index -= 1) {
    if (buffer.readUInt32LE(index) === eocdSignature) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive: end-of-central-directory not found.')
  let count = buffer.readUInt16LE(eocd + 10)
  let directorySize = buffer.readUInt32LE(eocd + 12)
  let directoryOffset = buffer.readUInt32LE(eocd + 16)

  if (directoryOffset === 0xffffffff || count === 0xffff) {
    const locatorSignature = 0x07064b50
    for (let index = eocd - 20; index >= 0; index -= 1) {
      if (buffer.readUInt32LE(index) === locatorSignature) {
        const zip64End = Number(buffer.readBigUInt64LE(index + 8))
        count = Number(buffer.readBigUInt64LE(zip64End + 32))
        directorySize = Number(buffer.readBigUInt64LE(zip64End + 40))
        directoryOffset = Number(buffer.readBigUInt64LE(zip64End + 48))
        break
      }
    }
  }

  const entries = []
  let cursor = directoryOffset
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return { entries, directoryOffset }
}

function readEntry(buffer, entry) {
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26)
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28)
  const start = entry.localOffset + 30 + nameLength + extraLength
  const raw = buffer.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`)
}

/* --------------------------- binary XML parsing --------------------------- */

function parseStringPool(buffer, offset) {
  const stringCount = buffer.readUInt32LE(offset + 8)
  const flags = buffer.readUInt32LE(offset + 16)
  const stringsStart = buffer.readUInt32LE(offset + 20)
  const isUtf8 = (flags & 0x100) !== 0
  const strings = []
  for (let index = 0; index < stringCount; index += 1) {
    const stringOffset = offset + stringsStart + buffer.readUInt32LE(offset + 28 + index * 4)
    if (isUtf8) {
      let cursor = stringOffset
      const skip = (buffer[cursor] & 0x80) !== 0 ? 2 : 1
      cursor += skip
      let byteLength = buffer[cursor]
      if ((byteLength & 0x80) !== 0) {
        byteLength = ((byteLength & 0x7f) << 8) | buffer[cursor + 1]
        cursor += 2
      } else {
        cursor += 1
      }
      strings.push(buffer.toString('utf8', cursor, cursor + byteLength))
    } else {
      let charLength = buffer.readUInt16LE(stringOffset)
      let cursor = stringOffset + 2
      if ((charLength & 0x8000) !== 0) {
        charLength = ((charLength & 0x7fff) << 16) | buffer.readUInt16LE(cursor)
        cursor += 2
      }
      strings.push(buffer.toString('utf16le', cursor, cursor + charLength * 2))
    }
  }
  return strings
}

function formatValue(dataType, data, strings) {
  switch (dataType) {
    case 0x03:
      return strings[data] ?? `@string/${data}`
    case 0x10:
      return String(data | 0)
    case 0x12:
      return data === 0 ? 'false' : 'true'
    case 0x01:
      return `@ref/0x${data.toString(16)}`
    default:
      return `0x${data.toString(16)}`
  }
}

// Compiled manifests leave framework attribute names as empty strings and carry
// their attr resource id in the parallel RESOURCE_MAP chunk instead.
const ANDROID_ATTR_NAMES = new Map([
  [0x0101000f, 'debuggable'],
  [0x01010003, 'name'],
  [0x01010006, 'permission'],
  [0x01010010, 'exported'],
  [0x0101001e, 'label'],
  [0x0101020c, 'minSdkVersion'],
  [0x0101021b, 'versionCode'],
  [0x0101021c, 'versionName'],
  [0x01010270, 'targetSdkVersion'],
  [0x01010280, 'allowBackup'],
  [0x010102d3, 'fullBackupContent'],
  [0x01010527, 'networkSecurityConfig'],
  [0x01010604, 'usesCleartextTraffic'],
  [0x0101057a, 'roundIcon'],
  [0x01010544, 'dataExtractionRules'],
  [0x0101000d, 'scheme'],
  [0x01010002, 'icon']
])

function parseBinaryXml(buffer) {
  let cursor = 8
  let strings = []
  let resourceMap = []
  const elements = []
  while (cursor < buffer.length - 8) {
    const chunkType = buffer.readUInt16LE(cursor)
    const chunkSize = buffer.readUInt32LE(cursor + 4)
    if (chunkSize <= 0) break
    if (chunkType === 0x0001) {
      strings = parseStringPool(buffer, cursor)
    } else if (chunkType === 0x0180) {
      const headerSize = buffer.readUInt16LE(cursor + 2)
      resourceMap = []
      for (let offset = cursor + headerSize; offset + 4 <= cursor + chunkSize; offset += 4) {
        resourceMap.push(buffer.readUInt32LE(offset))
      }
    } else if (chunkType === 0x0102) {
      const nameIndex = buffer.readUInt32LE(cursor + 20)
      // attributeStart is relative to the start of the attrExt struct, which
      // begins 16 bytes into the node chunk (header + lineNumber + comment).
      const attributeStart = buffer.readUInt16LE(cursor + 24)
      const attributeSize = buffer.readUInt16LE(cursor + 26)
      const attributeCount = buffer.readUInt16LE(cursor + 28)
      const attributes = {}
      for (let index = 0; index < attributeCount; index += 1) {
        const base = cursor + 16 + attributeStart + index * (attributeSize || 20)
        const attributeNameIndex = buffer.readUInt32LE(base + 4)
        const pooled = strings[attributeNameIndex]
        const attributeName =
          pooled && pooled.length > 0
            ? pooled
            : (ANDROID_ATTR_NAMES.get(resourceMap[attributeNameIndex]) ??
              `attr:0x${(resourceMap[attributeNameIndex] ?? 0).toString(16)}`)
        const dataType = buffer[base + 15]
        const data = buffer.readUInt32LE(base + 16)
        attributes[attributeName] = formatValue(dataType, data, strings)
      }
      elements.push({ name: strings[nameIndex], attributes })
    }
    cursor += chunkSize
  }
  return elements
}

/* ------------------------- signing block inspection ----------------------- */

function readSigningBlock(archive, directoryOffset) {
  const magic = Buffer.from('APK Sig Block 42', 'utf8')
  if (directoryOffset < 32) return null
  if (!archive.subarray(directoryOffset - 16, directoryOffset).equals(magic)) return null
  const blockSize = Number(archive.readBigUInt64LE(directoryOffset - 24))
  const blockStart = directoryOffset - blockSize - 8
  if (blockStart < 0) return null
  const pairs = []
  let cursor = blockStart + 8
  while (cursor + 12 <= directoryOffset - 24) {
    const pairLength = Number(archive.readBigUInt64LE(cursor))
    if (pairLength <= 4 || cursor + 8 + pairLength > directoryOffset) break
    const id = archive.readUInt32LE(cursor + 8)
    pairs.push({ id, value: archive.subarray(cursor + 12, cursor + 8 + pairLength) })
    cursor += 8 + pairLength
  }
  return { blockStart, blockSize, pairs }
}

function extractCertificates(region) {
  const certificates = []
  const seen = new Set()
  for (let index = 0; index + 4 < region.length; index += 1) {
    if (region[index] !== 0x30 || region[index + 1] !== 0x82) continue
    const length = region.readUInt16BE(index + 2) + 4
    if (index + length > region.length) continue
    const der = region.subarray(index, index + length)
    try {
      const certificate = new X509Certificate(der)
      const fingerprint = certificate.fingerprint256
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)
      certificates.push(certificate)
    } catch {
      /* not a certificate at this offset */
    }
  }
  return certificates
}

/* ------------------------------ secret scan ------------------------------ */

const SECRET_RULES = [
  ['Turso database URL', /libsql:\/\/[a-z0-9-]+/gi],
  ['Turso auth token (JWT)', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./g],
  ['Cloudflare R2 endpoint', /[a-f0-9]{32}\.r2\.cloudflarestorage\.com/gi],
  ['AWS/R2 access key id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Explicit secret assignment', /\b(AUTH_SECRET|TURSO_AUTH_TOKEN|TURSO_DATABASE_URL|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|BACKUP_ENCRYPTION_KEY|RENDER_API_KEY|DEPLOY_HOOK)\s*[=:]\s*['"][^'"\s]{8,}/g],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['Dev backend host', /https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0|192\.168\.\d+\.\d+)(:\d+)?/gi],
  ['ngrok/tunnel host', /[a-z0-9-]+\.(ngrok(-free)?\.(io|app|dev)|trycloudflare\.com|loca\.lt)/gi]
]

const EXPECTED_BACKEND = 'https://moneywise-f4jh.onrender.com'
// Recognizable plaintext fixtures that must never ship inside the binary.
const FIXTURE_CANARIES = ['CANARY-', 'test@example.com', 'seed-financial-fixture', 'MoneyWiseTestAccount']

/* --------------------------------- main ---------------------------------- */

const archive = readFileSync(target)
const { entries, directoryOffset } = readZipEntries(archive)
const isBundle = target.toLowerCase().endsWith('.aab')

console.log(`ARTIFACT: ${target}`)
console.log(`SIZE: ${(archive.length / 1048576).toFixed(2)} MB`)
console.log(`ENTRIES: ${entries.length}`)
console.log('')

/* manifest */
const manifestName = isBundle ? 'base/manifest/AndroidManifest.xml' : 'AndroidManifest.xml'
const manifestEntry = entries.find((entry) => entry.name === manifestName)
if (!manifestEntry) {
  console.log(`MANIFEST: NOT FOUND (${manifestName})`)
} else {
  const elements = parseBinaryXml(readEntry(archive, manifestEntry))
  const manifest = elements.find((element) => element.name === 'manifest')
  const application = elements.find((element) => element.name === 'application')
  const usesSdk = elements.find((element) => element.name === 'uses-sdk')
  console.log('--- MANIFEST ---')
  console.log('package:', manifest?.attributes?.package ?? '(bundle: declared in BundleConfig)')
  console.log('versionName:', manifest?.attributes?.versionName ?? '-')
  console.log('versionCode:', manifest?.attributes?.versionCode ?? '-')
  console.log('minSdkVersion:', usesSdk?.attributes?.minSdkVersion ?? '-')
  console.log('targetSdkVersion:', usesSdk?.attributes?.targetSdkVersion ?? '-')
  console.log('allowBackup:', application?.attributes?.allowBackup ?? '-')
  console.log('usesCleartextTraffic:', application?.attributes?.usesCleartextTraffic ?? '(unset)')
  console.log('networkSecurityConfig:', application?.attributes?.networkSecurityConfig ?? '(unset)')
  console.log('debuggable:', application?.attributes?.debuggable ?? 'false')
  console.log('fullBackupContent:', application?.attributes?.fullBackupContent ?? '(unset)')
  console.log('dataExtractionRules:', application?.attributes?.dataExtractionRules ?? '(unset)')
  console.log('')
  console.log('all <application> attributes:')
  for (const [key, value] of Object.entries(application?.attributes ?? {})) {
    console.log(`  ${key} = ${value}`)
  }
  console.log('')
  const schemes = elements
    .filter((element) => element.name === 'data' && element.attributes.scheme)
    .map((element) => element.attributes.scheme)
  console.log('DEEP LINK SCHEMES:', [...new Set(schemes)].join(', ') || 'none')
  console.log('')
  const permissions = elements
    .filter((element) => element.name === 'uses-permission' || element.name === 'uses-permission-sdk-23')
    .map((element) => element.attributes.name)
  console.log('PERMISSIONS (' + permissions.length + '):')
  permissions.forEach((permission) => console.log('  ' + permission))
  console.log('')
  const exported = elements.filter(
    (element) =>
      ['activity', 'service', 'receiver', 'provider', 'activity-alias'].includes(element.name) &&
      element.attributes.exported === 'true'
  )
  console.log('EXPORTED COMPONENTS (' + exported.length + '):')
  exported.forEach((element) =>
    console.log(`  <${element.name}> ${element.attributes.name} permission=${element.attributes.permission ?? 'none'}`)
  )
  console.log('')
}

/* signing */
console.log('--- SIGNING ---')
const jarSignatureFiles = entries.filter((entry) => /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(entry.name))
const hasJarManifest = entries.some((entry) => entry.name === 'META-INF/MANIFEST.MF')
console.log('v1 (JAR) signature files:', jarSignatureFiles.map((entry) => entry.name).join(', ') || 'none')
console.log('META-INF/MANIFEST.MF present:', hasJarManifest)

const SCHEME_IDS = new Map([
  [0x7109871a, 'APK Signature Scheme v2'],
  [0xf05368c0, 'APK Signature Scheme v3'],
  [0x1b93ad61, 'APK Signature Scheme v3.1'],
  [0x7109871b, 'APK Signature Scheme v4 metadata'],
  [0x42726577, 'verity padding']
])

const signingBlock = readSigningBlock(archive, directoryOffset)
console.log('APK Signing Block:', signingBlock ? 'PRESENT' : 'absent')
let certificates = []
if (signingBlock) {
  for (const pair of signingBlock.pairs) {
    const label = SCHEME_IDS.get(pair.id) ?? `unknown id 0x${pair.id.toString(16)}`
    console.log(`  block id 0x${pair.id.toString(16).padStart(8, '0')} -> ${label} (${pair.value.length} bytes)`)
    if (SCHEME_IDS.has(pair.id) && pair.id !== 0x42726577) {
      certificates = certificates.concat(extractCertificates(pair.value))
    }
  }
}
for (const entry of jarSignatureFiles) {
  certificates = certificates.concat(extractCertificates(readEntry(archive, entry)))
}

const unique = new Map(certificates.map((certificate) => [certificate.fingerprint256, certificate]))
console.log('')
console.log('SIGNER CERTIFICATES (' + unique.size + '):')
let debugCertificate = false
for (const certificate of unique.values()) {
  const subject = certificate.subject.replace(/\n/g, ', ')
  console.log('  subject:    ', subject)
  console.log('  issuer:     ', certificate.issuer.replace(/\n/g, ', '))
  console.log('  valid:      ', certificate.validFrom, '->', certificate.validTo)
  console.log('  SHA-256:    ', certificate.fingerprint256)
  console.log('  key:        ', certificate.publicKey.asymmetricKeyType, certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? '')
  if (/Android Debug|androiddebugkey/i.test(subject)) debugCertificate = true
  console.log('')
}
console.log('DEBUG KEYSTORE USED:', debugCertificate ? 'YES  <-- BLOCKER' : 'NO')
console.log('SIGNED:', (hasJarManifest && jarSignatureFiles.length > 0) || signingBlock ? 'YES' : 'NO')
console.log('')

/* secret + config scan across every entry */
console.log('--- SECRET / CONFIG SCAN ---')
const findings = new Map()
let backendSeenIn = []
let canariesSeenIn = []
let scannedBytes = 0

for (const entry of entries) {
  if (entry.uncompressedSize === 0) continue
  let content
  try {
    content = readEntry(archive, entry)
  } catch {
    continue
  }
  scannedBytes += content.length
  const text = content.toString('latin1')
  for (const [label, pattern] of SECRET_RULES) {
    pattern.lastIndex = 0
    const matches = text.match(pattern)
    if (matches) {
      const bucket = findings.get(label) ?? new Set()
      matches.slice(0, 5).forEach((match) => bucket.add(`${match}  [${entry.name}]`))
      findings.set(label, bucket)
    }
  }
  if (text.includes(EXPECTED_BACKEND)) backendSeenIn.push(entry.name)
  for (const canary of FIXTURE_CANARIES) {
    if (text.includes(canary)) canariesSeenIn.push(`${canary} [${entry.name}]`)
  }
}

console.log(`scanned ${(scannedBytes / 1048576).toFixed(1)} MB of decompressed entry data`)
console.log('')
console.log('production backend URL present:', backendSeenIn.length > 0 ? `YES (${backendSeenIn.slice(0, 3).join(', ')})` : 'NO  <-- BLOCKER')
console.log('plaintext fixture canaries:', canariesSeenIn.length > 0 ? `FOUND -> ${canariesSeenIn.slice(0, 5).join(', ')}` : 'none')
console.log('')
if (findings.size === 0) {
  console.log('SECRET SCAN: CLEAN — no secret or dev-endpoint pattern matched')
} else {
  console.log('SECRET SCAN FINDINGS:')
  for (const [label, bucket] of findings) {
    console.log(`  ${label}:`)
    ;[...bucket].slice(0, 5).forEach((value) => console.log(`    ${value}`))
  }
}

/* shipped JS bundle: contract markers and build-tool reachability */
console.log('')
console.log('--- SHIPPED JS BUNDLE ---')
const bundleEntry = entries.find((entry) => /(^|\/)assets\/index\.android\.bundle$/.test(entry.name))
if (!bundleEntry) {
  console.log('index.android.bundle: NOT FOUND')
} else {
  const bundle = readEntry(archive, bundleEntry)
  const isHermes = bundle.subarray(0, 8).toString('hex').startsWith('c61fbc03')
  console.log('entry:', bundleEntry.name, `(${(bundle.length / 1048576).toFixed(2)} MB)`)
  console.log('format:', isHermes ? 'Hermes bytecode (.hbc)' : 'plain JavaScript')
  const bundleText = bundle.toString('latin1')
  const markers = [
    ['moneyVersion', /moneyVersion/],
    ['AES-256-GCM envelope', /AES-256-GCM/],
    ['SecureStore key scope', /encryptionKey\.v3/],
    ['sync push endpoint', /\/api\/sync\/push/],
    ['production backend host', /moneywise-f4jh\.onrender\.com/],
    ['__DEV__ dev-session branch', /devSession|__DEV__\s*&&\s*login/]
  ]
  for (const [label, pattern] of markers) {
    console.log(`  ${pattern.test(bundleText) ? 'present' : 'absent '}  ${label}`)
  }
  // Build-only tooling must not appear in the shipped runtime bundle.
  const buildOnly = ['metro-config', 'image-size', 'node_modules/xcode', '@expo/config-plugins', 'metro-transform-worker']
  console.log('  build-tool packages reachable in bundle:')
  for (const name of buildOnly) {
    console.log(`    ${bundleText.includes(name) ? 'PRESENT <-- investigate' : 'absent'}  ${name}`)
  }
}
