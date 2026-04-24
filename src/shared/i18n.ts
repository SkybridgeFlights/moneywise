import type { AppLanguage, BudgetMethod, Category, CategoryBudgetInsight, GoalPriority, GoalType, PaymentMethod } from './types'

export const languageMeta: Record<AppLanguage, { locale: string; rtl: boolean }> = {
  ar: { locale: 'ar-EG', rtl: true },
  en: { locale: 'en-US', rtl: false }
}

const builtInCategoryLabels: Record<string, Record<AppLanguage, string>> = {
  housing: { ar: 'السكن / الإيجار', en: 'Housing / Rent' },
  food: { ar: 'الطعام / البقالة', en: 'Food / Groceries' },
  transportation: { ar: 'المواصلات', en: 'Transportation' },
  utilities: { ar: 'الخدمات', en: 'Utilities' },
  'internet-phone': { ar: 'الإنترنت / الهاتف', en: 'Internet / Phone' },
  health: { ar: 'الصحة', en: 'Health' },
  education: { ar: 'التعليم', en: 'Education' },
  entertainment: { ar: 'الترفيه', en: 'Entertainment' },
  shopping: { ar: 'التسوق', en: 'Shopping' },
  debt: { ar: 'الديون / الأقساط', en: 'Debt / Installments' },
  savings: { ar: 'الادخار', en: 'Savings' },
  investments: { ar: 'الاستثمارات', en: 'Investments' },
  family: { ar: 'العائلة', en: 'Family' },
  emergency: { ar: 'الطوارئ', en: 'Emergency' },
  misc: { ar: 'متفرقات', en: 'Miscellaneous' }
}

export function getCategoryDisplayName(category: Pick<Category, 'id' | 'name' | 'builtIn'>, language: AppLanguage): string {
  if (category.builtIn && builtInCategoryLabels[category.id] && category.name === builtInCategoryLabels[category.id].en) {
    return builtInCategoryLabels[category.id][language]
  }
  return category.name
}

export const budgetMethodLabels: Record<BudgetMethod, Record<AppLanguage, string>> = {
  'fifty-thirty-twenty': { ar: 'قاعدة 50 / 30 / 20', en: '50 / 30 / 20 Rule' },
  'zero-based': { ar: 'الميزانية الصفرية', en: 'Zero-based Budgeting' },
  'custom-percentage': { ar: 'نِسَب مخصصة', en: 'Custom Percentages' },
  'priority-based': { ar: 'حسب الأولوية', en: 'Priority-based' },
  'goal-first': { ar: 'الأهداف أولاً', en: 'Goals First' },
  'debt-focused': { ar: 'تركيز على سداد الدين', en: 'Debt-focused' }
}

export const paymentMethodLabels: Record<PaymentMethod, Record<AppLanguage, string>> = {
  cash: { ar: 'نقداً', en: 'Cash' },
  bank: { ar: 'بنك', en: 'Bank' },
  card: { ar: 'بطاقة', en: 'Card' },
  wallet: { ar: 'محفظة', en: 'Wallet' },
  transfer: { ar: 'تحويل', en: 'Transfer' }
}

export const goalTypeLabels: Record<GoalType, Record<AppLanguage, string>> = {
  general: { ar: 'ادخار عام', en: 'General Savings' },
  'emergency-fund': { ar: 'صندوق طوارئ', en: 'Emergency Fund' },
  travel: { ar: 'سفر', en: 'Travel' },
  device: { ar: 'جهاز', en: 'Device' },
  'debt-payoff': { ar: 'سداد دين', en: 'Debt Payoff' },
  'large-purchase': { ar: 'شراء كبير', en: 'Large Purchase' }
}

export const priorityLabels: Record<GoalPriority, Record<AppLanguage, string>> = {
  high: { ar: 'عالية', en: 'High' },
  medium: { ar: 'متوسطة', en: 'Medium' },
  low: { ar: 'منخفضة', en: 'Low' }
}

export const financeStatusLabels: Record<CategoryBudgetInsight['status'], Record<AppLanguage, string>> = {
  healthy: { ar: 'صحي', en: 'Healthy' },
  watch: { ar: 'مراقبة', en: 'Watch' },
  danger: { ar: 'خطر', en: 'Danger' }
}

export const riskLevelLabels: Record<'low' | 'moderate' | 'high', Record<AppLanguage, string>> = {
  low: { ar: 'منخفض', en: 'Low' },
  moderate: { ar: 'متوسط', en: 'Moderate' },
  high: { ar: 'مرتفع', en: 'High' }
}

export const financeCopy = {
  alertBudgetExceeded: (language: AppLanguage, categoryName: string, overPercent: number) =>
    language === 'ar'
      ? {
          title: `تجاوزت الميزانية في ${categoryName}`,
          message: `الإنفاق الفعلي أعلى من المستوى الموصى به بنسبة ${overPercent.toFixed(1)}%.`
        }
      : {
          title: `Budget limit exceeded in ${categoryName}`,
          message: `Actual spending is ${overPercent.toFixed(1)}% above the recommended level.`
        },
  alertLowBalance: (language: AppLanguage) =>
    language === 'ar'
      ? {
          title: 'الرصيد المتبقي منخفض',
          message: 'الرصيد المتوقع لنهاية الفترة يقترب من منطقة غير صحية. خفّض الإنفاق المرن مبكراً.'
        }
      : {
          title: 'Remaining balance is too low',
          message: 'Your period-end balance is approaching an unhealthy zone. Reduce flexible spending early.'
        },
  alertSavingsRate: (language: AppLanguage) =>
    language === 'ar'
      ? {
          title: 'معدل الادخار أقل من الهدف',
          message: 'مساهمة الادخار الحالية أقل من 10% من الدخل. زد تمويل الأهداف أو خفّض المصروفات غير الضرورية.'
        }
      : {
          title: 'Savings rate is below target',
          message: 'The current savings contribution is below 10% of income. Increase goal funding or reduce discretionary spending.'
        },
  alertUnusualSpending: (language: AppLanguage, count: number) =>
    language === 'ar'
      ? {
          title: 'تم رصد إنفاق غير معتاد',
          message: `هناك ${count} عملية إنفاق أعلى بشكل ملحوظ من النمط الطبيعي للفئة.`
        }
      : {
          title: 'Unusual spending detected',
          message: `${count} transaction(s) are significantly above the normal category pattern.`
        },
  alertGoalPressure: (language: AppLanguage) =>
    language === 'ar'
      ? {
          title: 'خطة الأهداف الحالية غير واقعية',
          message: 'الأهداف ذات الأولوية تتطلب مساهمات شهرية أعلى من السيولة المتاحة حالياً.'
        }
      : {
          title: 'Current goal plan may be unrealistic',
          message: 'Priority goals require higher monthly contributions than your current free cash allows.'
        },
  alertNotificationsDisabled: (language: AppLanguage) =>
    language === 'ar'
      ? {
          title: 'التنبيهات الذكية متوقفة',
          message: 'تم تعطيل الإشعارات في الإعدادات، لذلك قد تفوتك التحذيرات المهمة.'
        }
      : {
          title: 'Smart alerts are muted',
          message: 'Notifications are disabled in settings, so critical warnings may be missed.'
        },
  recIncreaseSavings: (language: AppLanguage) =>
    language === 'ar'
      ? 'ارفع تحويلات الادخار عبر تقليل جزء من إنفاق التسوق والترفيه المرن.'
      : 'Increase savings transfers by redirecting a portion of flexible shopping and entertainment spending.',
  recDebtPressure: (language: AppLanguage) =>
    language === 'ar'
      ? 'عبء الدين مرتفع. فعّل وضع التركيز على الدين أو سرّع السداد قبل إضافة التزامات جديدة.'
      : 'Debt burden is elevated. Use debt-focused mode or accelerate payoff before adding new commitments.',
  recSpendingPace: (language: AppLanguage) =>
    language === 'ar'
      ? 'وتيرة الإنفاق الحالية تشير إلى إجمالي أعلى من المخطط لنهاية الفترة. شدد ضبط الفئات الاختيارية مبكراً.'
      : 'Current spending pace suggests a higher period-end total than planned. Tighten discretionary categories early.',
  recGoalUnrealistic: (language: AppLanguage) =>
    language === 'ar'
      ? 'هدف أو أكثر يحتاج إلى مساهمات شهرية غير واقعية. مدّد التواريخ المستهدفة أو خفّض عدد الأهداف المتوازية.'
      : 'One or more goals require unrealistic monthly contributions. Extend target dates or reduce parallel goals.',
  recOverspend: (language: AppLanguage, categoryName: string, amount: number) =>
    language === 'ar'
      ? `خفّض الإنفاق في ${categoryName} بنحو ${amount.toFixed(2)} هذا الشهر للعودة إلى الخطة.`
      : `Reduce ${categoryName} by about ${amount.toFixed(2)} this month to return to plan.`,
  recZeroIncome: (language: AppLanguage) =>
    language === 'ar'
      ? 'الدخل صفر في الفترة النشطة مع وجود مصروفات. أدخل مصادر الدخل قبل الاعتماد على مؤشرات الميزانية.'
      : 'Income is zero for the active period while expenses exist. Enter income sources before trusting budget outputs.',
  recBalanced: (language: AppLanguage) =>
    language === 'ar'
      ? 'الخطة الحالية متوازنة. حافظ على انضباط الفئات وراجع الأداء أسبوعياً لمنع الانحراف.'
      : 'The current plan is balanced. Maintain category discipline and review weekly for drift.'
}
