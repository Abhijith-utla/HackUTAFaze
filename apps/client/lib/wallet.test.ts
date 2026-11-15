import assert from "node:assert/strict";
import test from "node:test";
import { explainWalletError, signAndSendDevnet, type PhantomProvider } from "./wallet";

test("Phantom errors become actionable messages", () => {
  assert.match(explainWalletError({ code: 4100, message: "The requested method and/or account has not been authorized by the user." }, "sign").message, /authorised this site/);
  assert.equal(explainWalletError({ code: 4001 }, "sign").code, 4001);
  assert.match(explainWalletError(new Error("403 Forbidden"), "sign").message, /RPC refused/);
  const net = explainWalletError(new Error("failed to fetch"), "sign");
  assert.equal(net.uncertain, true);
});

test("a 4100 on sign reconnects once, then signs and broadcasts through our own RPC", async () => {
  let connects = 0, signs = 0, sent = 0;
  const tx = { serialize: () => Buffer.from("signed") } as never;
  const phantom: PhantomProvider = {
    connect: async () => { connects++; return { publicKey: {} as never }; },
    signTransaction: async () => { if (++signs === 1) throw Object.assign(new Error("unauthorized"), { code: 4100 }); return tx; },
    signAndSendTransaction: async () => { throw new Error("must not be used when signTransaction exists"); },
  };
  const connection = { sendRawTransaction: async () => { sent++; return "sig123"; } } as never;
  assert.equal(await signAndSendDevnet(phantom, connection, tx), "sig123");
  assert.deepEqual([connects, signs, sent], [1, 2, 1]);
});
