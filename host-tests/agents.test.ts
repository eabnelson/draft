import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk';
import {readClaudeResult} from '../desktop/agents';

async function* messages(...events:unknown[]){for(const event of events)yield event as SDKMessage;}
const revoked='Failed to authenticate: OAuth token revoked. Please log in again or contact your administrator.';
const signIn=(error:unknown)=>error instanceof Error&&error.name==='AgentSignInError'&&/Sign in to Claude Code again in Model settings/.test(error.message);

test('a revoked login in a success-shaped Claude result asks the user to reconnect',async()=>{
 await assert.rejects(readClaudeResult(messages({type:'result',subtype:'success',is_error:true,result:revoked})),signIn);
});
test('startup authentication failures and SDK-thrown authentication errors use the same recovery',async()=>{
 await assert.rejects(readClaudeResult(messages({type:'result',subtype:'error_during_execution',is_error:true,errors:[revoked]})),signIn);
 async function* failed():AsyncGenerator<SDKMessage>{throw Error(`Claude Code returned an error result: ${revoked}`);}
 await assert.rejects(readClaudeResult(failed()),signIn);
});
test('normal structured results succeed and unrelated errors do not disclose raw agent output',async()=>{
 assert.equal(await readClaudeResult(messages({type:'result',subtype:'success',is_error:false,structured_output:{ok:true}})),'{"ok":true}');
 await assert.rejects(readClaudeResult(messages({type:'result',is_error:true,result:'Private candidate source: do not display this'})),error=>error instanceof Error&&error.message==='The agent could not complete this request. Try again or choose another model.');
});
