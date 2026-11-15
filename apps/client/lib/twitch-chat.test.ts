// Run with: cd apps/client && npx tsx --test lib/twitch-chat.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseIrcLine } from './twitch-chat';

test('parses a tagged PRIVMSG and counts emote occurrences', () => {
  const line = '@badge-info=;color=#FF0000;display-name=Someone;emotes=25:0-4,6-10/1902:12-16;id=abc :someone!someone@someone.tmi.twitch.tv PRIVMSG #scump :Kappa Kappa Keepo';
  assert.deepEqual(parseIrcLine(line), { user: 'someone', text: 'Kappa Kappa Keepo', emotes: 3 });
});
test('no emotes tag / empty emotes -> 0; ACTION wrapper stripped', () => {
  assert.equal((parseIrcLine('@emotes= :a!a@a.tmi.twitch.tv PRIVMSG #c :hello') as any).emotes, 0);
  assert.equal((parseIrcLine(':a!a@a.tmi.twitch.tv PRIVMSG #c :hello') as any).emotes, 0);
  assert.equal((parseIrcLine(':a!a@a.tmi.twitch.tv PRIVMSG #c :\u0001ACTION screams\u0001') as any).text, 'screams');
});
test('keeps colons and unicode in the message body', () => {
  assert.equal((parseIrcLine(':a!a@a.tmi.twitch.tv PRIVMSG #c :look: 5-3 😮 POG') as any).text, 'look: 5-3 😮 POG');
});
test('PING is flagged; joins, notices and junk are ignored', () => {
  assert.equal(parseIrcLine('PING :tmi.twitch.tv'), 'ping');
  assert.equal(parseIrcLine(':tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!'), null);
  assert.equal(parseIrcLine(':a!a@a.tmi.twitch.tv JOIN #c'), null);
  assert.equal(parseIrcLine('@msg-id=x :tmi.twitch.tv NOTICE #c :hi'), null);
  assert.equal(parseIrcLine('garbage'), null);
});
