import { expect } from 'chai';
import protobuf from 'protobufjs';

import { BigNumber } from '@ethersproject/bignumber';
import { keccak256 } from '@ethersproject/solidity';
import { Wallet } from '@ethersproject/wallet';

protobuf.common('google/protobuf/descriptor.proto', {});

interface Proto {
  Slash: protobuf.Type;
  Reward: protobuf.Type;
  AcctAmtPair: protobuf.Type;
  Signer: protobuf.Type;
  SortedSigners: protobuf.Type;
}

async function getProtos(): Promise<Proto> {
  const staking = await protobuf.load(`${__dirname}/../../contracts/libraries/proto/staking.proto`);
  const signer = await protobuf.load(`${__dirname}/../../contracts/libraries/proto/signer.proto`);

  const Slash = staking.lookupType('staking.Slash');
  const Reward = staking.lookupType('staking.Reward');
  const AcctAmtPair = staking.lookupType('staking.AcctAmtPair');

  const Signer = signer.lookupType('signer.Signer');
  const SortedSigners = signer.lookupType('signer.SortedSigners');

  return {
    Slash,
    Reward,
    AcctAmtPair,
    Signer,
    SortedSigners
  };
}

function hex2Bytes(hexString: string): number[] {
  let hex = hexString;
  const result = [];
  if (hex.substr(0, 2) === '0x') {
    hex = hex.slice(2);
  }
  if (hex.length % 2 === 1) {
    hex = '0' + hex;
  }
  for (let i = 0; i < hex.length; i += 2) {
    result.push(parseInt(hex.substr(i, 2), 16));
  }
  return result;
}

function uint2Bytes(x: BigNumber): number[] {
  return hex2Bytes(x.toHexString());
}

async function calculateSignatures(signers: Wallet[], hash: number[]): Promise<number[][]> {
  const sigs = [];
  for (let i = 0; i < signers.length; i++) {
    const sig = await signers[i].signMessage(hash);
    sigs.push(hex2Bytes(sig));
  }
  return sigs;
}

export async function getRewardRequest(
  recipient: string,
  cumulativeReward: BigNumber,
  signers: Wallet[]
): Promise<{ rewardBytes: Uint8Array; sigs: number[][] }> {
  const { Reward } = await getProtos();
  const reward = {
    recipient: hex2Bytes(recipient),
    cumulativeReward: uint2Bytes(cumulativeReward)
  };
  const rewardProto = Reward.create(reward);
  const rewardBytes = Reward.encode(rewardProto).finish();
  const rewardBytesHash = keccak256(['bytes'], [rewardBytes]);
  const sigs = await calculateSignatures(signers, hex2Bytes(rewardBytesHash));

  return { rewardBytes, sigs };
}

async function getAcctAmtPairs(accounts: string[], amounts: BigNumber[]): Promise<protobuf.Message[]> {
  const { AcctAmtPair } = await getProtos();
  expect(accounts.length).to.equal(amounts.length);
  const pairs = [];
  for (let i = 0; i < accounts.length; i++) {
    const pair = {
      account: hex2Bytes(accounts[i]),
      amount: uint2Bytes(amounts[i])
    };
    const pairProto = AcctAmtPair.create(pair);
    pairs.push(pairProto);
  }
  return pairs;
}

export async function getSlashRequest(
  validatorAddr: string,
  nonce: number,
  slashFactor: number,
  expireTime: number,
  jailPeriod: number,
  collectorAddrs: string[],
  collectorAmts: BigNumber[],
  signers: Wallet[]
): Promise<{ slashBytes: Uint8Array; sigs: number[][] }> {
  const { Slash } = await getProtos();

  const collectors = await getAcctAmtPairs(collectorAddrs, collectorAmts);
  const slash = {
    validator: hex2Bytes(validatorAddr),
    nonce: nonce,
    slashFactor: slashFactor,
    expireTime: expireTime,
    jailPeriod: jailPeriod,
    collectors: collectors
  };
  const slashProto = Slash.create(slash);
  const slashBytes = Slash.encode(slashProto).finish();
  const slashBytesHash = keccak256(['bytes'], [slashBytes]);
  const sigs = await calculateSignatures(signers, hex2Bytes(slashBytesHash));

  return { slashBytes, sigs };
}

export async function getSignersBytes(accounts: string[], tokens: BigNumber[], sort: Boolean) {
  const { Signer, SortedSigners } = await getProtos();
  const ss = [];
  for (let i = 0; i < accounts.length; i++) {
    const signer = {
      account: hex2Bytes(accounts[i]),
      tokens: uint2Bytes(tokens[i])
    };
    ss.push(signer);
  }
  if (sort) {
    ss.sort((a, b) => (a.account > b.account ? 1 : -1));
  }
  const signers = [];
  for (let i = 0; i < ss.length; i++) {
    const signerProto = Signer.create(ss[i]);
    signers.push(signerProto);
  }
  const signersProto = {
    signers: signers
  };
  const signersBytes = SortedSigners.encode(signersProto).finish();
  return signersBytes;
}

export async function getUpdateSignersRequest(
  newAccounts: string[],
  newTokens: BigNumber[],
  currSigners: Wallet[],
  currTokens: BigNumber[],
  sort: Boolean
): Promise<{ newSignersBytes: Uint8Array; currSignersBytes: Uint8Array; sigs: number[][] }> {
  const currAccounts = [];
  for (let i = 0; i < currSigners.length; i++) {
    currAccounts.push(currSigners[i].address);
  }
  const currSignersBytes = await getSignersBytes(currAccounts, currTokens, sort);

  const newSignersBytes = await getSignersBytes(newAccounts, newTokens, sort);
  const newSignersBytesHash = keccak256(['bytes'], [newSignersBytes]);

  currSigners.sort((a, b) => (a.address.toLowerCase() > b.address.toLowerCase() ? 1 : -1));
  const sigs = await calculateSignatures(currSigners, hex2Bytes(newSignersBytesHash));

  return { newSignersBytes, currSignersBytes, sigs };
}
