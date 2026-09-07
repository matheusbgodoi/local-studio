"use client";

import { useRouter } from "next/navigation";
import { SettingsView } from "@/features/settings/settings-view";
import { useSettings } from "@/features/settings/use-settings";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { legacyIntegrationHref } from "@/features/integrations/integration-navigation";
import { useControllerCapabilities } from "@/hooks/controller-capabilities-store";
import type { CapabilityState } from "@local-studio/contracts/capabilities";

export default function SettingsPage() {
  const { capabilities, controllerKey } = useControllerCapabilities();
  return (
    <SettingsPageForController
      key={controllerKey}
      controllerKey={controllerKey}
      configCapability={capabilities.features.config}
      compatibilityCapability={capabilities.features.compatibility}
      runtimeManagementCapability={capabilities.features.runtimeManagement}
    />
  );
}

function SettingsPageForController({
  controllerKey,
  configCapability,
  compatibilityCapability,
  runtimeManagementCapability,
}: {
  controllerKey: string;
  configCapability: CapabilityState;
  compatibilityCapability: CapabilityState;
  runtimeManagementCapability: CapabilityState;
}) {
  const router = useRouter();
  const configs = useSettings(controllerKey, configCapability, compatibilityCapability);
  useMountSubscription(() => {
    const integrationHref = legacyIntegrationHref(window.location.hash);
    if (integrationHref) router.replace(integrationHref);
  }, [router]);

  return (
    <SettingsView
      data={configs.data}
      compatibilityReport={configs.compatibilityReport}
      loading={configs.loading}
      error={configs.error}
      apiSettings={configs.apiSettings}
      apiSettingsLoading={configs.apiSettingsLoading}
      testing={configs.testing}
      connectionStatus={configs.connectionStatus}
      statusMessage={configs.statusMessage}
      hasConfigData={configs.hasConfigData}
      isInitialLoading={configs.isInitialLoading}
      onReload={configs.loadConfig}
      onApiSettingsChange={configs.setApiSettings}
      onTestConnection={configs.testConnection}
      onSystemSectionActive={configs.ensureConfigLoaded}
      runtimeManagementCapability={runtimeManagementCapability}
      configCapability={configCapability}
      compatibilityCapability={compatibilityCapability}
    />
  );
}
