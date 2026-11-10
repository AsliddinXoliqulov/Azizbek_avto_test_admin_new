import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { transliterateUzbekToCyrillic } from './translation'
import chaptersTranslations from './locales/chapters'
import managementTranslations from './locales/management'
import questionsTranslations from './locales/questions'

export type SiteLanguage = 'uz-Latn' | 'uz-Cyrl' | 'ru'
type SiteLanguageContextValue = {
  language: SiteLanguage
  setLanguage: (language: SiteLanguage) => void
  t: (text: string) => string
}

const languageContext = createContext<SiteLanguageContextValue | null>(null)

const russianTranslations: Record<string, string> = {
  'Bosh sahifa': 'Главная',
  'Bosh menu': 'Главное меню',
  Orqaga: 'Назад',
  'Sayt tili': 'Язык сайта',
  Saqlash: 'Сохранить',
  Yopish: 'Закрыть',
  'Rasmni kattalashtirish': 'Увеличить изображение',
  'Bekor qilish': 'Отмена',
  'Saqlanmoqda…': 'Сохранение…',
  Tasdiqlash: 'Подтвердить',
  'Tarjima qilinmoqda…': 'Перевод…',
  'Qolgan tillarni to‘ldirish': 'Заполнить остальные языки',
  'O‘zbekcha matndan kirill va rus tiliga tarjima qilish. Ruscha tarjima MyMemory servisiga yuboriladi.': 'Перевод узбекского текста на кириллицу и русский язык. Русский текст отправляется в сервис MyMemory.',
  'Kirill va rus tiliga avtomatik tarjima': 'Автоматический перевод на кириллицу и русский язык',
  'Rasmni yuklab bo‘lmadi.': 'Не удалось загрузить изображение.',
  'Rasm yuklanmoqda…': 'Загрузка изображения…',
  'Rasmni olib tashlash': 'Удалить изображение',
  'Yangi rasm qo‘shish uchun avval mavjud rasmni olib tashlang.': 'Чтобы добавить новое изображение, сначала удалите существующее.',
  'Rasm URL manzili': 'URL изображения',
  'URL qo‘shish': 'Добавить URL',
  'Boshqaruv paneli': 'Панель управления',
  'Davom etish uchun admin hisobingizga kiring.': 'Войдите в учетную запись администратора, чтобы продолжить.',
  'Kirish havolasi email manzilingizga yuborildi. Xatdagi havolani ochib panelga kiring.': 'Ссылка для входа отправлена на вашу почту. Откройте ссылку из письма, чтобы войти в панель.',
  'Supabase sozlanmagan. Frontend papkasidagi .env.example faylidan .env yarating va Supabase URL hamda anon public key ni kiriting.': 'Supabase не настроен. Создайте файл .env из .env.example в папке Frontend и укажите URL Supabase и публичный anon-ключ.',
  'Brauzer menyusidan “Ilovani o‘rnatish” yoki “Bosh ekranga qo‘shish” bandini tanlang.': 'Выберите в меню браузера «Установить сайт» или «Добавить на главный экран».',
  'Ilovani o‘rnatib bo‘lmadi. Brauzer menyusidan qayta urinib ko‘ring.': 'Не удалось установить сайт. Повторите попытку через меню браузера.',
  'Brauzeringiz menyusidan “Ilovani o‘rnatish” yoki “Bosh ekranga qo‘shish”ni tanlang. Bu band bo‘lmasa, saytni PWA o‘rnatishni qo‘llaydigan brauzerda oching.': 'Выберите в меню браузера «Установить приложение» или «Добавить на главный экран». Если такого пункта нет, откройте сайт в браузере с поддержкой установки PWA.',
  'iPhone’da Safari’da oching, “Ulashish” tugmasini bosing va “Bosh ekranga qo‘shish”ni tanlang.': 'Откройте сайт в Safari на iPhone, нажмите «Поделиться», затем выберите «На экран Домой».',
  'Mavzuni bo‘limdan ajratish': 'Убрать тему из раздела',
  'Ushbu mavzuni bo‘limdan ajratmoqchimisiz?': 'Убрать эту тему из раздела?',
  'Savolni mavzudan ajratish': 'Убрать вопрос из темы',
  'Ushbu savolni mavzudan ajratmoqchimisiz?': 'Убрать этот вопрос из темы?',
  Ajratish: 'Убрать',
  'Email havolasi': 'Ссылка по электронной почте',
  'Login va parol': 'Логин и пароль',
  'Admin email': 'Электронная почта администратора',
  Parol: 'Пароль',
  'Kutilmoqda…': 'Загрузка…',
  'Gmail’ga kirish havolasini yuborish': 'Отправить ссылку для входа на Gmail',
  'Login va parol bilan kirish': 'Войти с логином и паролем',
  'Admin huquqlari tekshirilmoqda…': 'Проверка прав администратора…',
  'Yuklanmoqda…': 'Загрузка…',
  'Admin huquqi topilmadi': 'Права администратора не найдены',
  'Bu foydalanuvchi admins jadvalida faol admin sifatida ro‘yxatdan o‘tmagan.': 'Этот пользователь не зарегистрирован как активный администратор.',
  'Admin profilingiz faol emas yoki topilmadi.': 'Профиль администратора неактивен или не найден.',
  Profil: 'Профиль',
  Admin: 'Администратор',
  'Profil menyusini ochish': 'Открыть меню профиля',
  'Profil va sozlamalar': 'Профиль и настройки',
  'Ilovani o‘rnatish': 'Установить сайт',
  'Kunduzgi rejim': 'Дневной режим',
  'Tungi rejim': 'Ночной режим',
  'Kunduzgi rejimga o‘tish': 'Включить дневной режим',
  'Tungi rejimga o‘tish': 'Включить ночной режим',
  'Hisobdan chiqish': 'Выйти',
  'Chiqilmoqda…': 'Выход…',
  'Savollar': 'Вопросы',
  'Boblar': 'Разделы',
  'Mavzular': 'Темы',
  'Kategoriyalar': 'Категории',
  'Kodlar': 'Коды',
  'Sozlamalar': 'Настройки',
  'Dashboard': 'Панель управления',
  ...chaptersTranslations,
  ...managementTranslations,
  ...questionsTranslations,
}

function readSavedLanguage(): SiteLanguage {
  const savedLanguage = localStorage.getItem('site-language')
  return savedLanguage === 'uz-Cyrl' || savedLanguage === 'ru'
    ? savedLanguage
    : 'uz-Latn'
}

export function SiteLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SiteLanguage>(readSavedLanguage)

  const setLanguage = useCallback((nextLanguage: SiteLanguage) => {
    setLanguageState(nextLanguage)
    localStorage.setItem('site-language', nextLanguage)
  }, [])

  const t = useCallback(
    (text: string) => {
      if (language === 'uz-Latn') return text
      if (language === 'uz-Cyrl') return transliterateUzbekToCyrillic(text)
      return russianTranslations[text] || text
    },
    [language]
  )

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  return (
    <languageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </languageContext.Provider>
  )
}

export function useSiteLanguage() {
  const context = useContext(languageContext)
  if (!context)
    throw new Error('Sayt tili konteksti topilmadi.')
  return context
}
