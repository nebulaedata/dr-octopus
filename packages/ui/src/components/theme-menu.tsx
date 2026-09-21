/**
 * @author Codex
 * @description Renders the shared theme menu for palette and display-mode selection.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { useTheme } from '@octopus/ui/hooks/use-theme';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ColorTheme, ThemeMode } from '@octopus/ui/lib/theme';

interface ColorThemeOption {
  value: ColorTheme;
  label: string;
}

interface ModeOption {
  value: ThemeMode;
  label: string;
  icon: typeof MonitorIcon;
}

/**
 * Describes every user-facing string the menu renders, letting callers localize it.
 */
export interface ThemeMenuI18n {
  colorThemeGroupLabel: string;
  modeGroupLabel: string;
  colorThemeLabels: Record<ColorTheme, string>;
  modeLabels: Record<ThemeMode, string>;
}

const DEFAULT_I18N: ThemeMenuI18n = {
  colorThemeGroupLabel: '配色主题',
  modeGroupLabel: '主题模式',
  colorThemeLabels: {
    default: '默认主题',
    electric: '电力蓝紫',
    shadcn: 'shadcn 经典',
  },
  modeLabels: {
    system: '系统跟随',
    light: '浅色',
    dark: '深色',
  },
};

const COLOR_THEME_VALUES: ColorTheme[] = ['default', 'electric', 'shadcn'];

const MODE_ICONS: Record<ThemeMode, typeof MonitorIcon> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};

const MODE_VALUES: ThemeMode[] = ['system', 'light', 'dark'];

export interface ThemeMenuProps {
  className?: string;
  render: (option: ColorThemeOption, mode: ModeOption) => React.ReactElement;
  /**
   * i18n overrides for the menu's user-facing strings.
   * Overrides the default Chinese copy; unspecified keys fall back to the Chinese defaults.
   * @default DEFAULT_I18N
   */
  i18n?: Partial<ThemeMenuI18n>;
}

/**
 * Provides a compact trigger and accessible exclusive choice groups.
 */
export function ThemeMenu(props: ThemeMenuProps) {
  const { className, render, i18n } = props;
  const { colorTheme, mode, setColorTheme, setMode } = useTheme();
  const colorThemeLabels = { ...DEFAULT_I18N.colorThemeLabels, ...i18n?.colorThemeLabels };
  const modeLabels = { ...DEFAULT_I18N.modeLabels, ...i18n?.modeLabels };
  const colorThemeGroupLabel = i18n?.colorThemeGroupLabel ?? DEFAULT_I18N.colorThemeGroupLabel;
  const modeGroupLabel = i18n?.modeGroupLabel ?? DEFAULT_I18N.modeGroupLabel;
  const colorThemes: ColorThemeOption[] = COLOR_THEME_VALUES.map((value) => ({
    value,
    label: colorThemeLabels[value],
  }));
  const modes: ModeOption[] = MODE_VALUES.map((value) => ({
    value,
    label: modeLabels[value],
    icon: MODE_ICONS[value],
  }));
  const activeColorTheme = colorThemes.find((option) => option.value === colorTheme) ?? colorThemes[0];
  const activeMode = modes.find((option) => option.value === mode) ?? modes[0];

  /**
   * Narrows the Base UI radio value before updating the palette contract.
   */
  function handleColorThemeChange(value: unknown) {
    if (value === 'default' || value === 'electric' || value === 'shadcn') {
      setColorTheme(value);
    }
  }

  /**
   * Narrows the Base UI radio value before updating the display-mode contract.
   */
  function handleModeChange(value: unknown) {
    if (value === 'system' || value === 'light' || value === 'dark') {
      setMode(value);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={render(activeColorTheme, activeMode)} />
      <DropdownMenuContent align="end" className={cn('w-56', className)}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{colorThemeGroupLabel}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={colorTheme} onValueChange={handleColorThemeChange}>
            {colorThemes.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <span
                  className="h-4 w-8 shrink-0 rounded-sm border border-border"
                  data-theme-swatch={option.value}
                  aria-hidden="true"
                />
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{modeGroupLabel}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={mode} onValueChange={handleModeChange}>
            {modes.map((option) => {
              const Icon = option.icon;

              return (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  <Icon data-icon="inline-start" />
                  {option.label}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
