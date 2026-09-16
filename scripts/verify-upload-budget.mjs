// Four real uploads against the two isolated rehearsal API containers.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { context, docker } from "./production-backup-lib.mjs";
const ctx = context();
assert.ok(
  ctx.config.rehearsal &&
    ctx.config.domain === "localhost" &&
    ctx.project === "tome-stabilization-rehearsal",
);
const directory = fs.mkdtempSync(path.join(ctx.dir, "upload-probe-"));
fs.chmodSync(directory, 0o700);
try {
  const credential = await docker([
    ...ctx.compose,
    "exec",
    "-T",
    "api-a",
    "cat",
    "/app/data/first-admin.txt",
  ]);
  const email = credential.match(/登录：([^\r\n]+)/)?.[1],
    password = credential.match(/初始密码：([^\r\n]+)/)?.[1];
  assert.ok(email === "stabilization@tome.test" && password);
  fs.writeFileSync(
    path.join(directory, "config.json"),
    JSON.stringify({ email, password, origin: ctx.config.origin }),
    { mode: 0o600 },
  );
  const compressed = await sharp(randomBytes(8000 * 5000 * 3), {
    raw: { width: 8000, height: 5000, channels: 3 },
  })
    .jpeg({ quality: 25 })
    .toBuffer();
  assert.ok(compressed.length < 20 * 1024 ** 2);
  // Valid JPEG plus harmless trailing padding exercises both exact limits together.
  const image = Buffer.alloc(20 * 1024 ** 2);
  compressed.copy(image);
  fs.writeFileSync(path.join(directory, "limit.jpg"), image);
  fs.writeFileSync(
    path.join(directory, "pixels.png"),
    await sharp({
      create: { width: 8001, height: 5000, channels: 3, background: "red" },
    })
      .png()
      .toBuffer(),
  );
  fs.writeFileSync(
    path.join(directory, "driver.mjs"),
    `
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const c=JSON.parse(fs.readFileSync('/probe/config.json'));
const file=fs.readFileSync('/probe/limit.jpg');
const sessions=[];
for(const host of ['api-a','api-b']) {
 const base='http://'+host+':4318/api';
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:c.origin},body:JSON.stringify({email:c.email,password:c.password})});
 assert.equal(login.status,201); const auth=await login.json(); const cookie=login.headers.get('set-cookie').split(';')[0];
 const headers={'Content-Type':'application/json',Origin:c.origin,Cookie:cookie,'X-CSRF-Token':auth.csrf,'Idempotency-Key':randomUUID()};
 const r=await fetch(base+'/items',{method:'POST',headers,body:JSON.stringify({title:'合成上传压力 '+randomUUID(),dataMode:'TEST'})}); assert.equal(r.status,201);
 sessions.push({base,headers,item:await r.json()});
}
async function upload(s,buffer,name) {
 const headers={...s.headers,'Idempotency-Key':randomUUID()}; delete headers['Content-Type'];
 const form=new FormData(); form.set('itemId',s.item.id); form.set('file',new Blob([buffer]),name);
 const r=await fetch(s.base+'/assets/upload',{method:'POST',headers,body:form}); await r.arrayBuffer(); return r.status;
}
const started=Date.now();
const statuses=await Promise.all(sessions.flatMap(s=>[upload(s,file,'limit.jpg'),upload(s,file,'limit.jpg')]));
assert.deepEqual(statuses,[201,201,201,201]);
const oversized=await upload(sessions[0],Buffer.concat([file,Buffer.from([0])]),'too-large.jpg'); assert.equal(oversized,413);
const overpixels=await upload(sessions[0],fs.readFileSync('/probe/pixels.png'),'too-many-pixels.png'); assert.equal(overpixels,400);
console.log(JSON.stringify({statuses,oversized,overpixels,elapsedMs:Date.now()-started}));
`,
  );
  const output = await docker([
    "run",
    "--rm",
    "--network",
    ctx.project + "_default",
    "--mount",
    `type=bind,source=${directory},target=/probe,readonly`,
    "--entrypoint",
    "node",
    `tome-workbench-migration:${ctx.config.appVersion}`,
    "/probe/driver.mjs",
  ]);
  const samples = [];
  for (const service of ["api-a", "api-b"]) {
    const id = await docker([...ctx.compose, "ps", "-q", service]);
    const state = JSON.parse(
      await docker(["inspect", "--format", "{{json .State}}", id]),
    );
    const peak = Number(
      await docker(["exec", id, "cat", "/sys/fs/cgroup/memory.peak"]),
    );
    assert.ok(state.Running && !state.OOMKilled && peak < 768 * 1024 ** 2);
    samples.push({
      service,
      peakBytes: peak,
      limitBytes: 768 * 1024 ** 2,
      oomKilled: state.OOMKilled,
    });
  }
  const report = {
    at: new Date().toISOString(),
    passed: true,
    synthetic: true,
    pixels: 40000000,
    bytes: image.length,
    concurrent: 4,
    requests: JSON.parse(output),
    samples,
  };
  fs.writeFileSync(
    "reports/upload-budget.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
