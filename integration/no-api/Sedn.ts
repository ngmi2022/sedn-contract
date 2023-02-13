/* eslint @typescript-eslint/no-var-requires: "off" */
import { Network } from "@ethersproject/providers";
import { expect } from "chai";
import { time } from "console";
import { BigNumber, Contract, Signer, Wallet, ethers } from "ethers";
import { MultiFactorAuthServerConfig } from "firebase-admin/lib/auth/auth-config";
import { check } from "prettier";
import { ConfigReturnValue } from "sedn-interfaces/dist/types";

import { FakeSigner } from "../../helper/FakeSigner";
import { sendTx } from "../../helper/signer";
import {
  checkAllowance,
  fetchConfig,
  generateClaimArgs,
  generateSecret,
  getAbi,
  getRpcUrl,
  sleep,
  waitTillRecipientBalanceChanged,
} from "../../helper/utils";

// /**********************************
// INTEGRATION PARAMS / ENVIRONMENT VARIABLES
// *************************************/

const TESTNET: boolean = process.env.TESTNET === "testnet" ? true : false; // we need to include this in workflow
const defaultNetworksToTest = TESTNET ? ["arbitrum-goerli"] : ["polygon"]; // "optimism", "arbitrum"
let ENVIRONMENT = process.env.ENVIRONMENT || "prod";
ENVIRONMENT = ENVIRONMENT === "dev" ? "prod" : ENVIRONMENT; // ensure that dev is always reverting to staging
const SIGNER_PK = process.env.SENDER_PK!;
const RECIPIENT_PK = process.env.RECIPIENT_PK!;
const UNFUNDED_SIGNER_PK = process.env.UNFUNDED_SIGNER_PK!;
const VERIFIER_PK = process.env.VERIFIER_PK!;
const AMOUNT_ENV = process.env.AMOUNT || "1";
let NETWORKS = process.env.NETWORKS || defaultNetworksToTest.join(",");
const networksToTest: string[] = NETWORKS.split(","); // ensure networks to test can be specified in workflow

// fixed variables
const gasless = true;

export interface ISednVariables {
  sedn: Contract;
  usdcOrigin: Contract;
  signer: ethers.Wallet;
  verifier: ethers.Wallet;
  config: ConfigReturnValue;
  recipient: ethers.Wallet;
  unfundedSigner: ethers.Wallet;
  trusted: FakeSigner;
  decDivider: BigNumber;
  amount: BigNumber;
  relayerWebhook: string;
  forwarderAddress: string;
}

async function getSedn(network: string): Promise<ISednVariables> {
  let config = await fetchConfig();
  const sednAddress = config.contracts[network].contract;
  const sednAbi = config.contracts[network].abi;
  const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
  const signer = new ethers.Wallet(SIGNER_PK, provider);
  const verifier = new ethers.Wallet(VERIFIER_PK, provider);
  const recipient = new ethers.Wallet(RECIPIENT_PK, provider);
  const unfundedSigner = new ethers.Wallet(UNFUNDED_SIGNER_PK, provider);
  const relayerWebhook = config.relayerWebhooks[network];
  const forwarderAddress = config.forwarder[network];
  // const forwarderAddress = "0x47b80475A1A4832a0dcbBc206E24Ddf6533aE2Bb";
  const sedn = new ethers.Contract(sednAddress, await getAbi(network, sednAbi), signer);
  const usdcOrigin = new ethers.Contract(
    config.usdc[network].contract,
    await getAbi(network, config.usdc[network].abi),
    signer,
  );
  const trusted = new FakeSigner(verifier, sedn.address);
  if (trusted.getAddress() !== config.verifier) {
    const error = new Error(`Using the wrong verifier: expected ${config.verifier} got ${trusted.getAddress()}`);
    console.error(error);
    throw error;
  }
  await sleep(1000);
  const decimals = await usdcOrigin.decimals();
  const decDivider = BigNumber.from(10 ** decimals + "");
  const amount = BigNumber.from(AMOUNT_ENV).mul(decDivider);
  return {
    sedn,
    usdcOrigin,
    signer,
    verifier,
    config,
    recipient,
    unfundedSigner,
    trusted,
    decDivider,
    amount,
    relayerWebhook,
    forwarderAddress,
  } as ISednVariables;
}

async function sednKnown(signer: Wallet, recipient: Wallet, deployed: ISednVariables, network: string) {
  // check allowance & if necessary increase approve
  const usdcOrigin = deployed.usdcOrigin;
  const sedn = deployed.sedn;
  const amount = deployed.amount;
  const relayerWebhook = deployed.relayerWebhook;
  const forwarder = deployed.forwarderAddress;
  await checkAllowance(deployed.usdcOrigin, signer, sedn, BigNumber.from(amount.toString() + "0"));

  // send
  const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address);
  const usdcBeforeSednContract = await usdcOrigin.balanceOf(sedn.address);
  const sednBeforeSednRecipient = await sedn.balanceOf(recipient.address);
  // TODO: put this shit in helper so its not duplicated
  const validUntilTime = (await signer.provider!.getBlock("latest")).timestamp + 1000;
  await sendTx(
    sedn,
    signer,
    "sednKnown",
    [amount, recipient.address],
    BigInt("0"),
    network,
    validUntilTime,
    gasless,
    relayerWebhook,
    forwarder,
  );

  // for some reason the usdcBalance does not update quickly enough
  await waitTillRecipientBalanceChanged(60_000, usdcOrigin, signer, usdcBeforeSednSigner);
  const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
  const usdcAfterSednContract = await usdcOrigin.balanceOf(sedn.address);
  const sednAfterSednRecipient = await sedn.balanceOf(recipient.address);

  // all three balances are checked; contract USDC, signer USDC and signer Sedn
  expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
  expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);
  expect(sednAfterSednRecipient.sub(sednBeforeSednRecipient)).to.equal(amount);
}

async function sednUnknown(signer: Wallet, deployed: ISednVariables, network: string, solution?: string) {
  const usdcOrigin = deployed.usdcOrigin;
  const sedn = deployed.sedn;
  const amount = deployed.amount;
  const relayerWebhook = deployed.relayerWebhook;
  const forwarder = deployed.forwarderAddress;
  // check allowance & if necessary increase approve
  await checkAllowance(usdcOrigin, signer, sedn, BigNumber.from(amount));

  // send
  const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address);
  const usdcBeforeSednContract = await usdcOrigin.balanceOf(sedn.address);
  let secret = "";
  if (!solution) {
    [solution, secret] = generateSecret();
  } else {
    secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  }

  const validUntilTime = (await signer.provider!.getBlock("latest")).timestamp + 1000;
  const tx = await sendTx(
    sedn,
    signer,
    "sednUnknown",
    [amount, secret],
    BigInt("0"),
    network,
    validUntilTime,
    gasless,
    relayerWebhook,
    forwarder,
  );
  const timestamp = (await signer.provider!.getBlock(tx.blockNumber)).timestamp;

  await waitTillRecipientBalanceChanged(60_000, usdcOrigin, signer, usdcBeforeSednSigner);
  // check sending
  const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
  const usdcAfterSednContract = await usdcOrigin.balanceOf(sedn.address);
  expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
  expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);
  return { solution, secret, timestamp };
}

async function transferKnown(signer: Wallet, recipient: Wallet, deployed: ISednVariables, network: string) {
  // check allowance & if necessary increase approve
  const sedn = deployed.sedn;
  const amount = deployed.amount;
  const relayerWebhook = deployed.relayerWebhook;
  const forwarder = deployed.forwarderAddress;

  // transfer
  const sednBeforeSednSigner = await sedn.balanceOf(signer.address);
  const sednBeforeSednRecipient = await sedn.balanceOf(recipient.address);
  // TODO: put this shit in helper so its not duplicated
  const validUntilTime = (await signer.provider!.getBlock("latest")).timestamp + 1000;
  await sendTx(
    sedn,
    signer,
    "transferKnown",
    [amount, recipient.address],
    BigInt("0"),
    network,
    validUntilTime,
    gasless,
    relayerWebhook,
    forwarder,
  );

  // for some reason the usdcBalance does not update quickly enough
  await waitTillRecipientBalanceChanged(60_000, sedn, signer, sednBeforeSednSigner);
  const sednAfterSednSigner = await sedn.balanceOf(signer.address);
  const sednAfterSednRecipient = await sedn.balanceOf(recipient.address);

  // all three balances are checked; contract USDC, signer USDC and signer Sedn
  expect(sednBeforeSednSigner.sub(sednAfterSednSigner)).to.equal(amount);
  expect(sednAfterSednRecipient.sub(sednBeforeSednRecipient)).to.equal(amount);
}

async function transferUnknown(signer: Wallet, deployed: ISednVariables, network: string, solution?: string) {
  const sedn = deployed.sedn;
  const amount = deployed.amount;
  const relayerWebhook = deployed.relayerWebhook;
  const forwarder = deployed.forwarderAddress;

  // transfer
  const sednBeforeSednSigner = await sedn.balanceOf(signer.address);
  let secret = "";
  if (!solution) {
    [solution, secret] = generateSecret();
  } else {
    secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  }

  const validUntilTime = (await signer.provider!.getBlock("latest")).timestamp + 1000;
  const tx = await sendTx(
    sedn,
    signer,
    "transferUnknown",
    [amount, secret],
    BigInt("0"),
    network,
    validUntilTime,
    gasless,
    relayerWebhook,
    forwarder,
  );
  const timestamp = (await signer.provider!.getBlock(tx.blockNumber)).timestamp;

  await waitTillRecipientBalanceChanged(60_000, sedn, signer, sednBeforeSednSigner);
  // check sending
  const sednAfterSednSigner = await sedn.balanceOf(signer.address);
  expect(sednBeforeSednSigner.sub(sednAfterSednSigner)).to.equal(amount);
  return { solution, secret, timestamp };
}

async function hybridKnown(signer: Wallet, recipient: Wallet, deployed: ISednVariables, network: string) {
  // check allowance & if necessary increase approve
  const usdcOrigin = deployed.usdcOrigin;
  const sedn = deployed.sedn;
  const amount = deployed.amount;
  const relayerWebhook = deployed.relayerWebhook;
  const forwarder = deployed.forwarderAddress;
  // check Allowance
  await checkAllowance(usdcOrigin, signer, sedn, BigNumber.from(amount));

  // transfer
  const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address);
  const sednBeforeSednSigner = await sedn.balanceOf(signer.address);
  const sednBeforeSednRecipient = await sedn.balanceOf(recipient.address);
  // TODO: put this shit in helper so its not duplicated
  const validUntilTime = (await signer.provider!.getBlock("latest")).timestamp + 1000;
  await sendTx(
    sedn,
    signer,
    "hybridKnown",
    [amount, amount, recipient.address],
    BigInt("0"),
    network,
    validUntilTime,
    gasless,
    relayerWebhook,
    forwarder,
  );

  // for some reason the usdcBalance does not update quickly enough
  await waitTillRecipientBalanceChanged(60_000, sedn, signer, sednBeforeSednSigner);
  const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
  const sednAfterSednSigner = await sedn.balanceOf(signer.address);
  const sednAfterSednRecipient = await sedn.balanceOf(recipient.address);

  // all three balances are checked; signer USDC and signer Sedn and recipient Sedn
  expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
  expect(sednBeforeSednSigner.sub(sednAfterSednSigner)).to.equal(amount);
  expect(sednAfterSednRecipient.sub(sednBeforeSednRecipient)).to.equal(amount.mul(2));
}

async function hybridUnknown(signer: Wallet, deployed: ISednVariables, network: string, solution?: string) {
  const usdcOrigin = deployed.usdcOrigin;
  const sedn = deployed.sedn;
  const amount = deployed.amount;
  const relayerWebhook = deployed.relayerWebhook;
  const forwarder = deployed.forwarderAddress;
  // check allowance & if necessary increase approve
  await checkAllowance(usdcOrigin, signer, sedn, BigNumber.from(amount));

  // send
  const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address);
  const usdcBeforeSednContract = await usdcOrigin.balanceOf(sedn.address);
  const sednBeforeSednSigner = await sedn.balanceOf(signer.address);
  let secret = "";
  if (!solution) {
    [solution, secret] = generateSecret();
  } else {
    secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  }

  const validUntilTime = (await signer.provider!.getBlock("latest")).timestamp + 1000;
  console.log("DEBUG: hybridUnknown Solution:", solution);
  const tx = await sendTx(
    sedn,
    signer,
    "hybridUnknown",
    [amount, amount, secret],
    BigInt("0"),
    network,
    validUntilTime,
    gasless,
    relayerWebhook,
    forwarder,
  );
  const timestamp = (await signer.provider!.getBlock(tx.blockNumber)).timestamp;

  await waitTillRecipientBalanceChanged(60_000, usdcOrigin, signer, usdcBeforeSednSigner);
  // check sending
  const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
  const usdcAfterSednContract = await usdcOrigin.balanceOf(sedn.address);
  const sednAfterSednSigner = await sedn.balanceOf(signer.address);
  expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
  expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);
  expect(sednBeforeSednSigner.sub(sednAfterSednSigner)).to.equal(amount);
  return { solution, secret, timestamp };
}

async function claim(claimer: Wallet, deployed: ISednVariables, network: string, solution: string, amount?: BigNumber) {
  const sedn = deployed.sedn;
  const relayerWebhook = deployed.relayerWebhook;
  const forwarder = deployed.forwarderAddress;
  const trusted = deployed.trusted;
  const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  if (!amount) {
    amount = deployed.amount;
  }
  const sednBeforeClaimRecipient = await sedn.balanceOf(claimer.address);
  const funcArgs = await generateClaimArgs(solution, secret, claimer, trusted);
  // TODO: get this shit into signer.ts
  const validUntilTime = (await claimer.provider!.getBlock("latest")).timestamp + 1000;
  await sendTx(
    sedn,
    claimer,
    "claim",
    funcArgs,
    BigInt("0"),
    network,
    validUntilTime,
    gasless,
    relayerWebhook,
    forwarder,
  );
  await waitTillRecipientBalanceChanged(60_000, sedn, claimer, sednBeforeClaimRecipient);

  // check claim
  const sednAfterClaimRecipient = await sedn.balanceOf(claimer.address);
  expect(sednAfterClaimRecipient.sub(sednBeforeClaimRecipient)).to.equal(amount);
}

async function withdraw(signer: Wallet, deployed: ISednVariables, network: string) {
  // withdraw
  const sedn = deployed.sedn;
  const usdcOrigin = deployed.usdcOrigin;
  const amount = deployed.amount;
  const relayerWebhook = deployed.relayerWebhook;
  const forwarder = deployed.forwarderAddress;

  const sednBeforeWithdrawSigner = await sedn.balanceOf(signer.address);
  const usdcBeforeWithdrawSigner = await usdcOrigin.balanceOf(signer.address);
  const validUntilTime = (await signer.provider!.getBlock("latest")).timestamp + 1000;
  // TODO: get this shit into signer.ts
  const txReceipt = await sendTx(
    sedn,
    signer,
    "withdraw",
    [amount, signer.address],
    BigInt("0"),
    network,
    validUntilTime,
    gasless,
    relayerWebhook,
    forwarder,
  );
  await waitTillRecipientBalanceChanged(60_000, usdcOrigin, signer, usdcBeforeWithdrawSigner);
  const sednAfterWithdrawSigner = await sedn.balanceOf(signer.address);
  const usdcAfterWithdrawSigner = await usdcOrigin.balanceOf(signer.address);
  expect(sednBeforeWithdrawSigner.sub(sednAfterWithdrawSigner)).to.equal(amount);
  expect(usdcAfterWithdrawSigner.sub(usdcBeforeWithdrawSigner)).to.equal(amount);
}

async function clawback(
  signer: Wallet,
  deployed: ISednVariables,
  network: string,
  solution: string,
  timestamp: number,
) {
  const sedn = deployed.sedn;
  const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  const relayerWebhook = deployed.relayerWebhook;
  const forwarder = deployed.forwarderAddress;

  const sednBeforeSednSigner = await sedn.balanceOf(signer.address);
  const validUntilTime = (await signer.provider!.getBlock("latest")).timestamp + 1000;
  const tx = await sendTx(
    sedn,
    signer,
    "clawback",
    [secret, timestamp],
    BigInt("0"),
    network,
    validUntilTime,
    false,
    relayerWebhook,
    forwarder,
  );
  const sednAfterSednSigner = await sedn.balanceOf(signer.address);
  console.log("sednBeforeSednSigner", sednBeforeSednSigner.toString());
  console.log("sednAfterSednSigner", sednAfterSednSigner.toString());
  expect(sednAfterSednSigner.sub(sednBeforeSednSigner)).to.equal(deployed.amount);
  return;
}

// /**********************************
// NO-API INTEGRATION TESTS
// *************************************/

networksToTest.forEach(function (network) {
  describe(`Sedn testing without api`, function () {
    let deployed: ISednVariables;
    beforeEach(async function () {
      deployed = await getSedn(network);
    });
    it("should correctly send funds to a registered user", async function () {
      await sednKnown(deployed.signer, deployed.recipient, deployed, network);
    });
    it("should send funds to an unregistered user", async function () {
      // sednUnknown
      const { solution, secret } = await sednUnknown(deployed.signer, deployed, network);

      // claim
      await claim(deployed.recipient, deployed, network, solution as string);
    });
    it("should sedn funds to an unregistered user who has already received funds", async function () {
      // sednUnknown
      const { solution, secret } = await sednUnknown(deployed.signer, deployed, network);

      // sednUnknown2
      await sednUnknown(deployed.recipient, deployed, network, solution as string);

      // claim
      await claim(deployed.recipient, deployed, network, solution as string, deployed.amount.mul(2));
    });
    it("should transfer funds to a registered user", async function () {
      const sednSignerBalance = await deployed.sedn.balanceOf(deployed.signer.address);
      if (sednSignerBalance.lt(deployed.amount)) {
        await sednKnown(deployed.signer, deployed.signer, deployed, network);
      }
      await transferKnown(deployed.signer, deployed.recipient, deployed, network);
    });
    it("should transfer funds to an unregistered user", async function () {
      const sednSignerBalance = await deployed.sedn.balanceOf(deployed.signer.address);
      if (sednSignerBalance.lt(deployed.amount)) {
        await sednKnown(deployed.signer, deployed.signer, deployed, network);
      }
      // transfer
      const { solution, secret } = await transferUnknown(deployed.signer, deployed, network);

      // claim
      await claim(deployed.recipient, deployed, network, solution as string);
    });
    it("should hybrid sedn funds to a registered user", async function () {
      // ensure balance
      const signerSednBalance = await deployed.sedn.balanceOf(deployed.signer.address);
      if (signerSednBalance.lt(deployed.amount)) {
        await sednKnown(deployed.signer, deployed.signer, deployed, network);
      }
      await hybridKnown(deployed.signer, deployed.recipient, deployed, network);
    });
    it("should hybrid sedn funds to an unregistered user", async function () {
      // ensure balance
      const signerSednBalance = await deployed.sedn.balanceOf(deployed.signer.address);
      if (signerSednBalance.lt(deployed.amount)) {
        await sednKnown(deployed.signer, deployed.signer, deployed, network);
      }
      // hybridUnknown
      const { solution, secret } = await hybridUnknown(deployed.signer, deployed, network);
      // claim
      await claim(deployed.recipient, deployed, network, solution as string, deployed.amount.mul(2));
    });
    it("should hybrid sedn funds to an unregistered user who has already received funds", async function () {
      // ensure balance
      const signerSednBalance = await deployed.sedn.balanceOf(deployed.signer.address);
      if (signerSednBalance.lt(deployed.amount)) {
        await sednKnown(deployed.signer, deployed.signer, deployed, network);
      }
      // hybridUnknown
      const { solution, secret } = await hybridUnknown(deployed.signer, deployed, network);

      // hybridUnknown2
      await hybridUnknown(deployed.recipient, deployed, network, solution as string);
      // claim
      await claim(deployed.recipient, deployed, network, solution as string, deployed.amount.mul(4));
    });
    it("should withdraw funds to a given address", async function () {
      const signerSednBalance = await deployed.sedn.balanceOf(deployed.signer.address);
      if (signerSednBalance.lt(deployed.amount)) {
        await sednKnown(deployed.signer, deployed.signer, deployed, network);
      }
      await withdraw(deployed.signer, deployed, network);
    });
    it("should not allow claiming if paused is true", async function () {
      // sednUnknown
      const { solution, secret } = await sednUnknown(deployed.signer, deployed, network);

      //pause stuff
      await deployed.sedn.connect(deployed.signer).setPause(true);

      // claim
      const funcArgs = await generateClaimArgs(solution, secret, deployed.recipient, deployed.trusted);
      // TODO: get this shit into signer.ts
      try {
        await deployed.sedn.connect(deployed.recipient).claim(...funcArgs);
      } catch (e) {
        expect(e.message).to.contain("Claiming is paused by admin");
      }
      // unpause stuff
      await deployed.sedn.connect(deployed.signer).setPause(false);

      // claim
      await claim(deployed.recipient, deployed, network, solution as string);
    });
    it.skip("should allow clawbacks", async function () {
      const { solution, secret, timestamp } = await sednUnknown(deployed.signer, deployed, network);
      let timestampCheck = (await deployed.signer.provider!.getBlock("latest")).timestamp;
      while (timestamp + 20 > timestampCheck) {
        await sleep(3000);
        timestampCheck = await (await deployed.signer.provider!.getBlock("latest")).timestamp;
        console.log(`current timestamp: ${timestampCheck} vs. ${timestamp}`);
      }
      await clawback(deployed.signer, deployed, network, solution as string, timestamp as number);
    });
  });
});
