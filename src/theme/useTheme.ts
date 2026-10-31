import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme, type Theme } from './tokens';

/** The theme for the device colour scheme (light unless the system is dark). */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme;
}
