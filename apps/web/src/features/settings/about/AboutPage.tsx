/**
 * @author Codex
 * @description Presents release, maintainer, and licensing information for Dr.Octopus.
 */

import { ExternalLinkIcon } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useI18n } from '@/i18n/use-i18n';
import { SettingContainer } from '../Layout/SettingContainer';

const repositoryUrl = 'https://github.com/nebulaedata/dr-octopus';
const releaseVersion = __OCTOPUS_RELEASE_VERSION__;
const releaseUrl = `${repositoryUrl}/releases/tag/v${releaseVersion}`;
const licenseUrl = `${repositoryUrl}/blob/v${releaseVersion}/LICENSE`;
const noticesUrl = `${repositoryUrl}/blob/v${releaseVersion}/THIRD_PARTY_NOTICES.md`;
const linkClassName =
  'inline-flex min-h-8 items-center gap-1 rounded-md text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Shows one compact About page in both canonical Settings and the Settings dialog.
 */
export function AboutPage() {
  const { t } = useI18n();

  const description = t(
    'settings.about.subtitle',
    'A local-first AI agent workspace powered by Pi, combining persistent memory, knowledge bases, and task automation through web and terminal interfaces.'
  );

  return (
    <SettingContainer classNames={{ content: 'max-w-2xl gap-7' }}>
      <div className="flex items-center gap-4">
        <Logo size="lg" />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('settings.about.productName', 'Dr.Octopus')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground truncate" title={description}>
            {description}
          </p>
        </div>
      </div>

      <div className="divide-y rounded-xl border bg-card text-sm">
        <section
          className="grid gap-2 p-5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-5"
          aria-labelledby="about-version"
        >
          <h2 id="about-version" className="font-medium">
            {t('settings.about.versionTitle', 'Version')}
          </h2>
          <div className="min-w-0 space-y-1">
            <p className="font-medium tabular-nums font-geist">
              {t('settings.about.versionValue', 'v{{version}}', { version: releaseVersion })}
            </p>
            <a href={releaseUrl} target="_blank" rel="noopener noreferrer" className={linkClassName}>
              {t('settings.about.releaseLink', 'View this release on GitHub')}
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        </section>

        <section
          className="grid gap-2 p-5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-5"
          aria-labelledby="about-maintainers"
        >
          <h2 id="about-maintainers" className="font-medium">
            {t('settings.about.maintainersTitle', 'Project and maintainers')}
          </h2>
          <div className="min-w-0 space-y-1">
            <p className="leading-relaxed text-muted-foreground">
              {t(
                'settings.about.maintainersDescription',
                'Open sourced by Nanjing Xingheng Data Technology Co., Ltd. and maintained together with community contributors.'
              )}
            </p>
            <a href={repositoryUrl} target="_blank" rel="noopener noreferrer" className={linkClassName}>
              {t('settings.about.repositoryLink', 'View project on GitHub')}
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        </section>

        <section
          className="grid gap-2 p-5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-5"
          aria-labelledby="about-license"
        >
          <h2 id="about-license" className="font-medium">
            {t('settings.about.licenseTitle', 'License')}
          </h2>
          <div className="min-w-0 space-y-1">
            <p className="font-medium">MIT</p>
            <div className="flex flex-wrap gap-x-5">
              <a href={licenseUrl} target="_blank" rel="noopener noreferrer" className={linkClassName}>
                {t('settings.about.licenseLink', 'View MIT license')}
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              </a>
              <a href={noticesUrl} target="_blank" rel="noopener noreferrer" className={linkClassName}>
                {t('settings.about.noticesLink', 'Third-party notices')}
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      </div>
    </SettingContainer>
  );
}
