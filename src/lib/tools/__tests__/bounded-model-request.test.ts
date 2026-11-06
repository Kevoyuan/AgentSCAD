import {afterEach,expect,test} from "bun:test";
import {createChatCompletionDetailed} from "../model-router";
import {createProviderChatCompletion,type ProviderConfig} from "../../provider-settings";
import {withLlmCallMeter,llmCallsThisRun} from "../../model-runtime";

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const provider:ProviderConfig={id:"bounded-test",name:"Bounded test",type:"deepseek",baseUrl:"https://api.deepseek.com",apiKey:"test-secret",defaultModel:"deepseek-v4-flash",enabled:true,isDefault:false,createdAt:"2026-11-05",updatedAt:"2026-11-05"};

test("explicit bounded provider requests cap output and use the single call meter",async()=>{
  let body:Record<string,unknown>={};
  globalThis.fetch=(async(_url,init)=>{
    body=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({model:"deepseek-flash",choices:[{message:{content:"cube(1);"},finish_reason:"stop"}],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}}));
  }) as typeof fetch;
  await withLlmCallMeter(async()=>{
    const result=await createChatCompletionDetailed({messages:[{role:"user",content:"test"}],model:"deepseek-v4-flash",providerOverride:provider,maxOutputTokens:65536,reasoningEffort:"none"});
    expect(result.model).toBe("deepseek-flash");
    expect(llmCallsThisRun()).toBe(1);
  });
  expect(body.max_tokens).toBe(65536);
  expect(body.model).toBe("deepseek-v4-flash");
  expect(body.reasoning_effort).toBe("none");
});

test("a bounded truncated reasoning reply cannot be admitted as a complete artifact",async()=>{
  globalThis.fetch=(async()=>new Response(JSON.stringify({model:"deepseek-flash",choices:[{message:{content:null,reasoning_content:"```scad\nmodule generated_part(){cube(1);}\ngenerated_part();\n```"},finish_reason:"length"}],usage:{prompt_tokens:12,completion_tokens:16,total_tokens:28}}))) as unknown as typeof fetch;
  try {
    await createChatCompletionDetailed({messages:[{role:"user",content:"test"}],providerOverride:provider,maxOutputTokens:16});
    throw new Error("Truncated artifact was accepted");
  } catch(error) {
    expect((error as {code?:string}).code).toBe("LLM_OUTPUT_TRUNCATED");
    expect((error as {evidence?:{usage?:{completionTokens?:number}}}).evidence?.usage?.completionTokens).toBe(16);
  }
});

test("ordinary provider requests omit the optional cap",async()=>{
  let body:Record<string,unknown>={};
  globalThis.fetch=(async(_url,init)=>{body=JSON.parse(String(init?.body));return new Response("{}");}) as typeof fetch;
  await createProviderChatCompletion({provider,messages:[{role:"user",content:"test"}]});
  expect(Object.hasOwn(body,"max_tokens")).toBe(false);
});

test("invalid caps fail before a network request and provider errors do not retry",async()=>{
  let calls=0;
  globalThis.fetch=(async()=>{calls++;return new Response("unavailable",{status:503});}) as unknown as typeof fetch;
  await expect(createChatCompletionDetailed({messages:[],providerOverride:provider,maxOutputTokens:0})).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(createChatCompletionDetailed({messages:[{role:"user",content:"test"}],providerOverride:provider,maxOutputTokens:16})).rejects.toThrow();
  expect(calls).toBe(1);
});
