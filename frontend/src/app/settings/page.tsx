"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SettingsView } from "@/features/settings/settings-view";
import { useSettings } from "@/features/settings/use-settings";
import { SetupView } from "@/features/setup/setup-view/setup-view";
import { useSetup } from "@/features/setup/use-setup";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { legacyIntegrationHref } from "@/features/integrations/integration-navigation";
import { useControllerCapabilities } from "@/hooks/controller-capabilities-store";
import type { CapabilityState } from "@local-studio/contracts/capabilities";

const hasSettingsHash = () => {
  if (typeof window === "undefined") return true;
  return window.location.hash.length > 1;
};

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
  const setup = useSetup();
  const [setupComplete] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("local-studio-setup-complete") === "true";
  });

  useMountSubscription(() => {
    const integrationHref = legacyIntegrationHref(window.location.hash);
    if (integrationHref) router.replace(integrationHref);
  }, [router]);

  const showSetupWizard =
    !hasSettingsHash() &&
    !configs.isInitialLoading &&
    configs.backendOnline === false &&
    !setupComplete &&
    !configs.hasConfigData;

  if (showSetupWizard) {
    return <SetupView {...setup} />;
  }

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
