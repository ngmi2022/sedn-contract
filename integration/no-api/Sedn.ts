/* eslint @typescript-eslint/no-var-requires: "off" */
import { expect } from "chai";
import fetch from "cross-fetch";
import { BigNumber, Contract, Wallet, ethers } from "ethers";

import { FakeSigner } from "../../helper/FakeSigner";
import { sendTx } from "../../helper/signer";
import {
  checkAllowance,
  checkFunding,
  feeData,
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
const defaultNetworksToTest = TESTNET ? ["arbitrum-goerli"] : ["arbitrum", "polygon"]; // "optimism", "arbitrum"
let ENVIRONMENT = process.env.ENVIRONMENT || "prod";
ENVIRONMENT = ENVIRONMENT === "dev" ? "staging" : ENVIRONMENT; // ensure that dev is always reverting to staging
const SIGNER_PK = process.env.SENDER_PK!;
const RECIPIENT_PK = process.env.RECIPIENT_PK!;
const UNFUNDED_SIGNER_PK = process.env.UNFUNDED_SIGNER_PK!;
const VERIFIER_PK = process.env.VERIFIER_PK!;
const AMOUNT_ENV = process.env.AMOUNT || "1.00";
let NETWORKS = process.env.NETWORKS || defaultNetworksToTest.join(",");
const networksToTest: string[] = NETWORKS.split(","); // ensure networks to test can be specified in workflow

// fixed variables
const gasless = false;

// /**********************************
// NO-API INTEGRATION TESTS
// *************************************/

describe("Sedn Contract", function () {
  async function getSedn(network: string) {
    let config = await fetchConfig();
    const sednContract = config.contracts[network];

    // TODO: support other providers
    const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
    const signer = new ethers.Wallet(SIGNER_PK, provider);
    const verifier = new ethers.Wallet(VERIFIER_PK, provider);
    const recipient = new ethers.Wallet(RECIPIENT_PK, provider);
    const unfundedSigner = new ethers.Wallet(UNFUNDED_SIGNER_PK, provider);
    const relayerWebhook = config.relayerWebhooks[network];
    const forwarder = config.forwarder[network];
    // Get Sedn
    const sedn = new ethers.Contract(sednContract, await getAbi(network, sednContract), signer);
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
    const decDivider = parseInt(10 ** decimals + "");
    const amount = parseInt(parseFloat(AMOUNT_ENV) * decDivider + "");
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
      forwarder,
    };
  }
  networksToTest.forEach(function (network) {
    describe(`Sedn testing without api`, function () {
      let sedn: Contract;
      let usdcOrigin: Contract;
      let signer: Wallet;
      let recipient: Wallet;
      let trusted: FakeSigner;
      let config: any;
      let decDivider: number;
      let amount: number;
      let relayerWebhook: string;
      let forwarder: string;
      beforeEach(async function () {
        const deployed = await getSedn(network);
        sedn = deployed.sedn;
        usdcOrigin = deployed.usdcOrigin;
        signer = deployed.signer;
        recipient = deployed.recipient;
        trusted = deployed.trusted;
        config = deployed.config;
        decDivider = deployed.decDivider;
        amount = deployed.amount;
        relayerWebhook = deployed.relayerWebhook;
        forwarder = deployed.forwarder;
      });
      it("should correctly send funds to a registered user", async function () {
        // check allowance & if necessary increase approve
        const allowanceChecked = await checkAllowance(usdcOrigin, signer, sedn, BigNumber.from(amount));

        // send
        const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address); // should be at least 10
        const usdcBeforeSednContract = await usdcOrigin.balanceOf(sedn.address);
        const sednBeforeSednSigner = await sedn.balanceOf(signer.address);
        // TODO: put this shit in helper so its not duplicated
        const fees = await feeData((await signer.provider.getNetwork()).name, signer);
        const tx = await sedn.connect(signer).sednKnown(amount, signer.address, {
          maxFeePerGas: fees.maxFee,
          maxPriorityFeePerGas: fees.maxPriorityFee,
        }); // send amount to signer itself
        await tx.wait();
        // for some reason the usdcBalance does not update quickly enough
        await waitTillRecipientBalanceChanged(60_000, usdcOrigin, signer, usdcBeforeSednSigner);
        const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
        const usdcAfterSednContract = await usdcOrigin.balanceOf(sedn.address);
        const sednAfterSednSigner = await sedn.balanceOf(signer.address);

        // all three balances are checked; contract USDC, signer USDC and signer Sedn
        expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
        expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);
        expect(sednAfterSednSigner.sub(sednBeforeSednSigner)).to.equal(amount);
      });
      it.only("should send funds to an unregistered user", async function () {
        // check allowance & if necessary increase approve
        const allowanceChecked = await checkAllowance(usdcOrigin, signer, sedn, BigNumber.from(amount));

        // send
        const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address);
        const usdcBeforeSednContract = await usdcOrigin.balanceOf(sedn.address);
        const sednBeforeClaimRecipient = await sedn.balanceOf(recipient.address);
        const [solution, secret] = generateSecret();

        // always gasfull
        const fees = await feeData((await signer.provider.getNetwork()).name, signer);
        const txSedn = await sedn.connect(signer).sednUnknown(amount, secret, {
          maxFeePerGas: fees.maxFee,
          maxPriorityFeePerGas: fees.maxPriorityFee,
        });
        const txReceipt = await txSedn.wait();
        await waitTillRecipientBalanceChanged(60_000, usdcOrigin, signer, usdcBeforeSednSigner);
        // check sending
        const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
        const usdcAfterSednContract = await usdcOrigin.balanceOf(sedn.address);
        expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
        expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);

        // claim
        const funcArgsTwo = await generateClaimArgs(solution, secret, recipient, trusted, amount);
        // TODO: get this shit into signer.ts
        const txReceiptTwo = await sendTx(
          sedn,
          recipient,
          recipient.privateKey,
          "claim",
          funcArgsTwo,
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, sedn, recipient, sednBeforeClaimRecipient);

        // check claim
        const sednAfterClaimRecipient = await sedn.balanceOf(recipient.address);
        expect(sednAfterClaimRecipient.sub(sednBeforeClaimRecipient)).to.equal(amount);
      });
      it("should transfer funds to an unregistered user", async function () {
        // check and adapt funding balances of signer
        let [useSigner, useRecipient] = await checkFunding(usdcOrigin, signer, recipient, sedn, amount);

        // transfer
        const sednBeforeTransferSigner = await sedn.balanceOf(useSigner.address);
        const [solution, secret] = generateSecret();
        const funcArgs = [amount, secret];
        const txReceipt = await sendTx(
          sedn,
          useSigner,
          useSigner.privateKey,
          "transferUnknown",
          funcArgs,
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, sedn, useSigner, sednBeforeTransferSigner);

        const sednAfterTransferSigner = await sedn.balanceOf(useSigner.address);
        expect(sednBeforeTransferSigner.sub(sednAfterTransferSigner)).to.equal(amount);

        // claim
        const sednBeforeClaimRecipient = await sedn.balanceOf(useRecipient.address);
        const funcArgsTwo = await generateClaimArgs(solution, secret, useRecipient, trusted, amount);
        // TODO: get this shit into signer.ts
        const txReceiptTwo = await sendTx(
          sedn,
          useRecipient,
          useRecipient.privateKey,
          "claim",
          funcArgsTwo,
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, sedn, useRecipient, sednBeforeClaimRecipient);
        const sednAfterClaimRecipient = await sedn.balanceOf(useRecipient.address);
        expect(sednAfterClaimRecipient.sub(sednBeforeClaimRecipient)).to.equal(amount);
      });
      it("should transfer funds to a registered user", async function () {
        // check and adapt funding balances of signer
        let [useSigner, useRecipient] = await checkFunding(usdcOrigin, signer, recipient, sedn, amount);

        // transfer
        const sednBeforeTransferSigner = await sedn.balanceOf(useSigner.address);
        const sednBeforeTransferRecipient = await sedn.balanceOf(useRecipient.address);
        const txReceipt = await sendTx(
          sedn,
          useSigner,
          useSigner.privateKey,
          "transferKnown",
          [amount, useRecipient.address],
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, sedn, useSigner, sednBeforeTransferSigner);
        const sednAfterTransferSigner = await sedn.balanceOf(useSigner.address);
        const sednAfterTransferRecipient = await sedn.balanceOf(useRecipient.address);
        expect(sednBeforeTransferSigner.sub(sednAfterTransferSigner)).to.equal(amount);
        expect(sednAfterTransferRecipient.sub(sednBeforeTransferRecipient)).to.equal(amount);
      });
      it("should withdraw funds to a given address", async function () {
        // check and adapt funding balances of signer
        let [useSigner, useRecipient] = await checkFunding(usdcOrigin, signer, recipient, sedn, amount);

        // withdraw
        const sednBeforeWithdrawSigner = await sedn.balanceOf(useSigner.address);
        const usdcBeforeWithdrawSigner = await usdcOrigin.balanceOf(useSigner.address);
        // TODO: get this shit into signer.ts
        const txReceipt = await sendTx(
          sedn,
          useSigner,
          useSigner.privateKey,
          "withdraw",
          [amount, useSigner.address],
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, usdcOrigin, useSigner, usdcBeforeWithdrawSigner);
        const sednAfterWithdrawSigner = await sedn.balanceOf(useSigner.address);
        const usdcAfterWithdrawSigner = await usdcOrigin.balanceOf(useSigner.address);
        expect(sednBeforeWithdrawSigner.sub(sednAfterWithdrawSigner)).to.equal(amount);
        expect(usdcAfterWithdrawSigner.sub(usdcBeforeWithdrawSigner)).to.equal(amount);
      });
    });
  });
});
