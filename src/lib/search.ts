const apostropheVariants = /['’‘ʻʼ`´ʹʽˈ‛]/gu

export function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .replace(apostropheVariants, '')
    .toLocaleLowerCase()
    .trim()
}
