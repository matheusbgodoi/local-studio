const INFERENCE_CREDENTIALS = new Set([
  "INFERENCE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACE_TOKEN",
  "HUGGING_FACE_HUB_TOKEN",
  "FRONTEND_TOKEN",
]);

export function shellExecutionEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => {
      const key = name.toUpperCase();
      return (
        !INFERENCE_CREDENTIALS.has(key) &&
        !(
          /^(LOCAL_AI_|LOCAL_STUDIO_|SITEGEIST_|PI_)/.test(key) &&
          /(TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|AUTH_KEY)/.test(key)
        )
      );
    }),
  );
}
