// Source of truth for UI strings. Run `node scripts/locales.mjs` to regenerate src/_locales.
import { mkdirSync, writeFileSync } from 'node:fs';

const p1 = { placeholders: { value: { content: '$1' } } };

/** key: [english, spanish, extra] */
const strings = {
  extName: ['Control Your Volume!', 'Control Your Volume!'],
  extDescription: [
    'Set the volume of each tab separately, with an optional boost up to 200%.',
    'Ajusta el volumen de cada pestaña por separado, con un amplificador opcional de hasta 200%.',
  ],
  cmdOpen: ['Open Control Your Volume!', 'Abrir Control Your Volume!'],
  cmdVolumeUp: ['Raise the current tab volume by 10%', 'Subir 10% el volumen de la pestaña actual'],
  cmdVolumeDown: [
    'Lower the current tab volume by 10%',
    'Bajar 10% el volumen de la pestaña actual',
  ],
  cmdToggleMute: ['Mute or unmute the current tab', 'Silenciar o reactivar la pestaña actual'],
  settings: ['Settings', 'Configuración'],
  back: ['Back', 'Volver'],
  thisTab: ['This tab', 'Esta pestaña'],
  playing: ['Playing audio', 'Con audio'],
  otherTabs: ['Other tabs', 'Otras pestañas'],
  search: ['Search tabs', 'Buscar pestañas'],
  noResults: ['No tabs match “$VALUE$”', 'Ninguna pestaña coincide con “$VALUE$”', p1],
  emptyPlaying: ['No other tab is playing audio', 'Ninguna otra pestaña está sonando'],
  mute: ['Mute', 'Silenciar'],
  unmute: ['Unmute', 'Reactivar sonido'],
  goToTab: ['Go to tab', 'Ir a la pestaña'],
  volumeOf: ['Volume of $VALUE$', 'Volumen de $VALUE$', p1],
  percentValue: ['$VALUE$ percent', '$VALUE$ por ciento', p1],
  editVolume: ['Volume percentage', 'Porcentaje de volumen'],
  restricted: [
    'The browser doesn’t allow extensions to change the volume of this page.',
    'El navegador no permite que las extensiones cambien el volumen de esta página.',
  ],
  notInvoked: [
    'Open the extension on this tab once to control it.',
    'Abre la extensión en esta pestaña una vez para controlarla.',
  ],
  captureFailed: [
    'Couldn’t control this tab’s audio. Try again.',
    'No se pudo controlar el audio de esta pestaña. Inténtalo de nuevo.',
  ],
  windowN: ['Window $VALUE$', 'Ventana $VALUE$', p1],
  pinned: ['Pinned', 'Fijada'],
  muted: ['Muted', 'Silenciada'],
  incognito: ['Incognito', 'Incógnito'],
  settingsBoost: ['Volume booster', 'Amplificador de volumen'],
  settingsBoostHint: [
    'Lets you go up to 200%. High levels can distort audio and harm your hearing or speakers.',
    'Permite subir hasta 200%. Los niveles altos pueden distorsionar el audio y dañar tus oídos o parlantes.',
  ],
  settingsBadge: ['Show volume on icon', 'Mostrar volumen en el ícono'],
  settingsBadgeHint: [
    'Displays the tab’s volume on the toolbar icon when it isn’t 100%.',
    'Muestra el volumen de la pestaña en el ícono cuando no está en 100%.',
  ],
  settingsTheme: ['Theme', 'Tema'],
  themeSystem: ['System', 'Sistema'],
  themeLight: ['Light', 'Claro'],
  themeDark: ['Dark', 'Oscuro'],
  settingsShortcuts: ['Keyboard shortcuts', 'Atajos de teclado'],
  settingsShortcutsHint: [
    'Raise, lower or mute the current tab without opening the extension.',
    'Sube, baja o silencia la pestaña actual sin abrir la extensión.',
  ],
  customize: ['Customize', 'Personalizar'],
  howItWorks: ['How it works', 'Cómo funciona'],
  howItWorksHint: [
    'While a tab’s volume isn’t 100%, the browser shows that tab as shared. Back at 100%, it stops.',
    'Mientras el volumen de una pestaña no esté en 100%, el navegador la muestra como compartida. Al volver a 100%, deja de hacerlo.',
  ],
  resetAll: ['Reset all tabs to 100%', 'Restablecer todas a 100%'],
  resetDone: ['All tabs are back to 100%', 'Todas las pestañas volvieron a 100%'],
  version: ['Version $VALUE$', 'Versión $VALUE$', p1],
  sourceCode: ['Source code', 'Código fuente'],
  untitled: ['Untitled', 'Sin título'],
};

for (const [index, locale] of ['en', 'es'].entries()) {
  const out = {};
  for (const [key, [en, es, extra]] of Object.entries(strings)) {
    out[key] = { message: index === 0 ? en : es, ...extra };
  }
  mkdirSync(`src/_locales/${locale}`, { recursive: true });
  writeFileSync(`src/_locales/${locale}/messages.json`, `${JSON.stringify(out, null, 2)}\n`);
}
console.log(`Wrote ${Object.keys(strings).length} strings × 2 locales`);
