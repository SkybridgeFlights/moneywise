import { Alert } from 'react-native'

export function confirmRecordDeletion(title: string, onConfirm: () => void): void {
  Alert.alert(
    `Delete ${title}?`,
    'This action cannot be undone. The deletion will also synchronize with your other signed-in devices.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm }
    ],
    { cancelable: true }
  )
}
