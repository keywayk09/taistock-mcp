import assert from 'node:assert/strict';
import { handleOwnerAuthorize } from '../src/v6/owner-oauth.ts';
const ORIGIN='https://taistock-mcp.keywayk09.workers.dev';
const env={MCP_API_KEY:'x',OAUTH_KV:{async get(){return null},async put(){},async delete(){}},OAUTH_PROVIDER:{}} as unknown as Env;
async function body(params:Record<string,string>){const u=new URL(`${ORIGIN}/authorize`);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);const r=await handleOwnerAuthorize(new Request(u),env);return {status:r.status,text:await r.text()}}
const base={response_type:'code',client_id:'abcdefgh12345678',redirect_uri:'https://chatgpt.com/connector/oauth/OwnerDiag123',resource:`${ORIGIN}/my-mcp`,scope:'owner:full offline_access mcp:tools',state:'state'};
for(const [label,patch] of [
  ['CLIENT_ID',{client_id:'x'}],
  ['REDIRECT_URI',{redirect_uri:'https://example.com/callback'}],
  ['STATE',{state:''}],
  ['SCOPE',{scope:'family:read'}],
] as const){const x=await body({...base,...patch});assert.equal(x.status,400);assert.match(x.text,new RegExp(`OAUTH-DIAG: ${label}`));assert.ok(!x.text.includes(base.client_id));assert.ok(!x.text.includes('chatgpt.com/connector/oauth/OwnerDiag123'));}
console.log('Owner safe OAuth diagnostics passed');
