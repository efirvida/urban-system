'use client';

import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

const LOCALES = [
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'es', label: 'Español' },
];

export default function LocaleSwitcher() {
  const { t, i18n } = useTranslation();

  const current = i18n.language?.startsWith('pt') ? 'pt-BR' : 'es';

  return (
    <div className="flex items-center gap-1.5">
      <Languages className="w-4 h-4 text-gray-400" aria-hidden="true" />
      <select
        value={current}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        className="text-xs bg-transparent border border-gray-200 rounded-md px-2 py-1 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer hover:border-gray-300 transition-colors"
        aria-label={t('localeSwitcher.ariaLabel')}
      >
        {LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.label}
          </option>
        ))}
      </select>
    </div>
  );
}
