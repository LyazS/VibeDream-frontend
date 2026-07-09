import Big from 'big.js'

export type MoneyString = string

// 严格金额字符串：给业务值 / 接口值使用，不接受 `.5`、`1.`、`1e-3` 这类形式。
const DECIMAL_INPUT_PATTERN = /^-?(?:0|[0-9]+)(?:\.[0-9]+)?$/
// 输入框编辑态：允许中间态，避免用户刚输入 `-` 或 `1.` 时就被拦掉。
const EDITABLE_DECIMAL_PATTERN = /^-?(?:\d+)?(?:\.\d*)?$/

// 放大指数边界，避免金额在前端链路里被 `big.js` 自动转成科学计数法。
Big.NE = -100
Big.PE = 100

function assertMoneyString(value: string): void {
  if (!DECIMAL_INPUT_PATTERN.test(value)) {
    throw new Error('Invalid money string')
  }
}

function bigToCanonicalString(value: Big): MoneyString {
  if (value.eq(0)) {
    return '0'
  }

  // 统一去掉无意义尾零和 `-0`，让业务值始终保持 canonical decimal string。
  const fixed = value.toFixed()
  const canonical = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
  return canonical === '-0' ? '0' : canonical
}

export function isEditableMoneyInput(value: string): boolean {
  if (value === '' || value === '-') {
    return true
  }
  return EDITABLE_DECIMAL_PATTERN.test(value)
}

export function isValidMoneyString(value: string): value is MoneyString {
  return DECIMAL_INPUT_PATTERN.test(value)
}

export function canonicalizeMoney(value: string): MoneyString {
  assertMoneyString(value)
  return bigToCanonicalString(new Big(value))
}

export function addMoney(left: MoneyString, right: MoneyString): MoneyString {
  return bigToCanonicalString(new Big(left).plus(new Big(right)))
}

export function subtractMoney(left: MoneyString, right: MoneyString): MoneyString {
  return bigToCanonicalString(new Big(left).minus(new Big(right)))
}

export function divideMoney(value: MoneyString, divisor: string | number): MoneyString {
  return bigToCanonicalString(new Big(value).div(divisor))
}

export function compareMoney(left: MoneyString, right: MoneyString): number {
  return new Big(left).cmp(new Big(right))
}

export function isZeroMoney(value: MoneyString): boolean {
  return compareMoney(value, '0') === 0
}

export function formatMoneyForDisplay(value: MoneyString | null | undefined): string {
  if (!value) {
    return '0.00'
  }

  // 展示层统一保留两位，并按产品约定做“向 0 截断”而不是四舍五入。
  const truncated = new Big(value).round(2, Big.roundDown)
  return truncated.toFixed(2)
}
