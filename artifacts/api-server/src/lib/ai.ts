import OpenAI from "openai";

function getClient(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "missing";

  if (!baseURL && !process.env.OPENAI_API_KEY) {
    throw new Error("No AI provider configured. Set AI_INTEGRATIONS_OPENAI_BASE_URL+AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY");
  }

  return new OpenAI({
    baseURL: baseURL || "https://api.openai.com/v1",
    apiKey,
  });
}

export async function chatCompletion(messages: OpenAI.Chat.ChatCompletionMessageParam[], model = "gpt-4o-mini"): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: 2048,
  });
  return response.choices[0]?.message?.content ?? "";
}

export async function generateText(prompt: string, model = "gpt-4o-mini"): Promise<string> {
  return chatCompletion([{ role: "user", content: prompt }], model);
}

export async function summarizeText(text: string): Promise<string> {
  return chatCompletion([
    { role: "system", content: "You are a summarization assistant. Provide clear, concise summaries." },
    { role: "user", content: `Summarize the following text:\n\n${text}` },
  ]);
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  return chatCompletion([
    { role: "system", content: `You are a translation assistant. Translate text to ${targetLanguage}. Return only the translation.` },
    { role: "user", content: text },
  ]);
}

export async function generateCode(prompt: string, language = "javascript"): Promise<string> {
  return chatCompletion([
    { role: "system", content: `You are an expert ${language} programmer. Write clean, working code. Return only code with brief comments.` },
    { role: "user", content: prompt },
  ]);
}

export async function describeImage(imageUrl: string): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image in detail." },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: 1024,
  });
  return response.choices[0]?.message?.content ?? "";
}
