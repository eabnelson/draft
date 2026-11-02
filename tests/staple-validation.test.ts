import {expect,test} from 'bun:test';
import {validateStaple} from '../scripts/mac-distribution';

const lost='error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."\nThe validate action failed! Error 68.';
const fake=(failures:string[])=>{const calls:string[][]=[];return {calls,run:async(args:string[])=>{calls.push(args);const failure=failures.shift();if(failure)throw Error(failure);return {stdout:'The validate action worked!',stderr:''};}};};

test('a dropped connection to Apple is retried until the ticket checks out',async()=>{
  const {calls,run}=fake([lost,lost]);
  expect((await validateStaple('Draft.dmg',{delay:0,run})).stdout).toContain('worked');
  expect(calls).toHaveLength(3);expect(calls[0]).toEqual(['xcrun','stapler','validate','Draft.dmg']);
});
test('a missing ticket fails at once, and Apple staying unreachable fails after the last try',async()=>{
  const missing=fake(['Draft.dmg does not have a ticket stapled to it.']);
  await expect(validateStaple('Draft.dmg',{delay:0,run:missing.run})).rejects.toThrow('does not have a ticket');
  expect(missing.calls).toHaveLength(1);
  const down=fake([lost,lost,lost]);
  await expect(validateStaple('Draft.dmg',{attempts:3,delay:0,run:down.run})).rejects.toThrow('network connection was lost');
  expect(down.calls).toHaveLength(3);
});
