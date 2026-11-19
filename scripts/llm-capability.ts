import { probeLlmCapability, saveCapability } from '../src/pipeline/llm.ts';

const cap = await probeLlmCapability();
saveCapability(cap);
console.log(JSON.stringify(cap, null, 2));
