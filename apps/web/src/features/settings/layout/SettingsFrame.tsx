/**
 * @author Codex
 * @description Renders the route-agnostic Settings navigation and content frame for pages and dialogs.
 */

import { useState } from 'react';
import { MenuIcon } from 'lucide-react';
import { HeaderTitle } from '@/components/HeaderTitle';
import { Button } from '@octopus/ui/components/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@octopus/ui/components/sheet';
import { findSettingsNavigationItem } from '../settings-navigation';
import { SettingsNavigation } from './SettingsNavigation';
import { SettingsSectionNavigationProvider } from './settings-section-navigation';
import { useI18n } from '@/i18n/use-i18n';
import type { ReactNode } from 'react';
import type { SettingsPath } from '../settings-navigation';

export interface SettingsFrameProps {
  pathname: SettingsPath;
  children: ReactNode;
  /**
   * Delegates navigation to the modal host; canonical pages omit it and render links.
   */
  onNavigate?(path: SettingsPath): void;
}

/**
 * Keeps Settings layout stable while navigation ownership varies by route presentation.
 */
export function SettingsFrame({ pathname, children, onNavigate }: SettingsFrameProps) {
  const { t } = useI18n();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const item = findSettingsNavigationItem(t, pathname);
  return (
    <SettingsSectionNavigationProvider value={onNavigate}>
      <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
        <aside className="hidden w-48 shrink-0 border-r md:block">
          <SettingsNavigation pathname={pathname} onNavigate={onNavigate} />
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-3 py-3 pr-12 md:px-5 md:pr-12">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Open Settings navigation"
              onClick={() => setNavigationOpen(true)}
            >
              <MenuIcon />
            </Button>
            <HeaderTitle
              title={item?.label ?? t('settings.frame.titleFallback', 'Settings')}
              description={item?.description ?? t('settings.frame.descriptionFallback', 'Manage application settings.')}
              truncateDescription={false}
            />
          </header>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
        </section>
        <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
          <SheetContent side="left" className="w-[18rem] gap-0 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t('settings.frame.navigationTitle', 'Settings navigation')}</SheetTitle>
              <SheetDescription>
                {t('settings.frame.navigationDescription', 'Navigate between global Settings modules.')}
              </SheetDescription>
            </SheetHeader>
            <SettingsNavigation
              pathname={pathname}
              onNavigate={onNavigate}
              onAfterNavigate={() => setNavigationOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </SettingsSectionNavigationProvider>
  );
}
