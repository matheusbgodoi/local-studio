import { expect, test } from "bun:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const helper = pathToFileURL(
  path.resolve(import.meta.dir, "../../../frontend/src/app/api/agent/long-runtime-request.ts"),
).href;

test("Node frontend transport handles delayed headers, cancellation, deadline and stream disposal", () => {
  const script = `
    import { createServer } from "node:http";
    import { longRuntimeRequest } from ${JSON.stringify(helper)};
    const watchdog=setTimeout(()=>process.exit(2),4000);
    async function fixture(listener) {
      const server=createServer(listener);
      await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
      return {url:"http://127.0.0.1:"+server.address().port+"/",close:()=>{server.closeAllConnections();server.close();}};
    }
    const input=(signal=new AbortController().signal)=>({method:"POST",headers:new Headers(),signal});
    const results={};
    const delayed=await fixture((req,res)=>{req.resume();setTimeout(()=>{res.writeHead(201,{"x-runtime":"retained"});res.end('{"ok":true}');},30);});
    try {
      const res=await longRuntimeRequest(delayed.url,input(),2000);
      results.delayed={status:res.status,header:res.headers.get("x-runtime"),body:await res.json()};
    } finally {delayed.close();}
    for(const cancel of [true,false]) {
      const controller=new AbortController();
      const f=await fixture(req=>{req.resume();if(cancel)controller.abort();});
      try {await longRuntimeRequest(f.url,input(controller.signal),cancel?2000:30);results[cancel?"cancelled":"deadline"]=false;}
      catch {results[cancel?"cancelled":"deadline"]=true;} finally {f.close();}
    }
    let closeResponse;
    const closed=new Promise(resolve=>{closeResponse=resolve;});
    const streaming=await fixture((req,res)=>{req.resume();res.on("close",closeResponse);res.writeHead(200);res.flushHeaders();});
    try {const res=await longRuntimeRequest(streaming.url,input(),2000);await res.body.cancel();await closed;results.streamClosed=true;}
    finally {streaming.close();}
    clearTimeout(watchdog);
    console.log(JSON.stringify(results));
  `;
  const result = Bun.spawnSync(
    ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString().trim())).toEqual({
    delayed: { status: 201, header: "retained", body: { ok: true } },
    cancelled: true,
    deadline: true,
    streamClosed: true,
  });
});
