/* eslint @typescript-eslint/no-var-requires: "off" */
import { expect } from "chai";
import { BigNumber, ethers } from "ethers";
import * as admin from "firebase-admin";
import {
  ChainId,
  Environment,
  IClaimRequest,
  IExecuteTransactionsRequest,
  IExecutionsResponse,
  ITransaction,
  IWireRequest,
  IWireResponse,
  IWithdrawRequest,
  TransactionType,
} from "sedn-interfaces";

import { FakeSigner } from "../../helper/FakeSigner";
import { createUserAndGenerateIdToken } from "../../helper/authUtils";
import {
  INetworkScenarios,
  apiCall,
  createFundingScenario,
  fetchConfig,
  getAbi,
  getBalance,
  getChainId,
  getRpcUrl,
  handleTxSignature,
  instantiateFundingScenario,
  sleep,
  waitTillRecipientBalanceChanged,
} from "../../helper/utils";

// /**********************************
// INTEGRATION PARAMS / ENVIRONMENT VARIABLES
// *************************************/

const TESTNET: boolean = process.env.TESTNET === "testnet" ? true : false; // we need to include this in workflow
const deployedNetworks = TESTNET ? ["arbitrum-goerli", "optimism-goerli"] : ["arbitrum", "optimism", "polygon"]; // "optimism", "arbitrum"
const networks = TESTNET ? ["arbitrum-goerli"] : ["arbitrum"];
let ENVIRONMENT = process.env.ENVIRONMENT || "prod";
const SIGNER_PK = process.env.SENDER_PK!;
const RECIPIENT_PK = process.env.RECIPIENT_PK!;
const UNFUNDED_SIGNER_PK = process.env.UNFUNDED_SIGNER_PK!;
const VERIFIER_PK = process.env.VERIFIER_PK!;
const AMOUNT_ENV = process.env.AMOUNT || "1.00";
let NETWORKS = process.env.NETWORKS || networks.join(",");
const networksToTest: string[] = NETWORKS.split(","); // ensure networks to test can be specified in workflow
const API_URLS: any = {
  prod: "https://us-central1-sedn-17b18.cloudfunctions.net",
  staging: "https://us-central1-staging-sedn.cloudfunctions.net",
  dev: "http://127.0.0.1:5001/staging-sedn/us-central1",
};
const API_URL = API_URLS[ENVIRONMENT];
ENVIRONMENT = ENVIRONMENT === "dev" ? "staging" : ENVIRONMENT; // ensure that dev is always reverting to staging

// fixed variables
const destinationNetworks = ["polygon", "arbitrum"];
const gasless = false;
const testnet: boolean = process.env.TESTNET === "testnet" ? true : false; // we need to include this in workflow
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const auth = admin.auth();

// /**********************************
// WITH-API INTEGRATION FUNCTIONS
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
    describe(`Sedn single chain testing with api`, function () {
      let sednVars: { [network: string]: any } = {};
      let deployed: any;
      const knownPhone = "+4917661597646";
      const unknownPhone = "+4917661597645";
      const claimerPhone = "+4917661597640";
      let knownAuthToken;
      let claimerAuthToken;
      beforeEach(async function () {
        for (const network of deployedNetworks) {
          deployed = await getSedn(network);
          sednVars[network] = deployed;
        }
        knownAuthToken = await createUserAndGenerateIdToken(
          auth,
          knownPhone,
          sednVars[networksToTest[0]].unfundedSigner.address,
        );
      });
      it.only(`should be able to correctly sedn funds to an unknown user`, async function () {
        // partially randomized scenario creation
        console.log("INFO: Creating funding scenario");
        const firstNetwork = networksToTest[0];
        const scenarioNetwork: INetworkScenarios = {};
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from(sednVars[firstNetwork].amount),
          sedn: BigNumber.from("0"),
        };
        const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
        await instantiateFundingScenario(completeFundingScenario, sednVars);
        console.log("INFO: Done funding");

        // establish previous usdc balances of unfundedSigner
        const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );

        // establish previous sedn balances of recipient
        const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );

        // build request for API
        const wireRequest: IWireRequest = {
          senderAddress: sednVars[firstNetwork].unfundedSigner.address,
          recipientId: unknownPhone,
          amount: sednVars[firstNetwork].amount,
          testnet: testnet,
        };

        // send request to API
        const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, knownAuthToken);

        // get approve and signatures
        const transactions: ITransaction[] = wireResponse.transactions;
        const signedTransactions: ITransaction[] = [];
        for (const transaction of transactions) {
          const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
          transaction.signedTx = signedRequest;
          signedTransactions.push(transaction);
        }

        // build api request
        const executeTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedTransactions,
          environment: ENVIRONMENT as Environment,
          type: wireResponse.type,
          recipientIdOrAddress: unknownPhone,
        };
        // send signed transactions to API
        const executionId = (await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, knownAuthToken))
          .id;
        console.log("INFO: executionIds", executionId);
        let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
        console.log("DEBUG: execution:", JSON.stringify(execution));
        while (execution.status !== "executed" && execution.status !== "failed") {
          console.log("INFO: not executed retrying for ID", executionId);
          await sleep(10_000);
          execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
          console.log(JSON.stringify(execution));
        }
        // establish usdc balances of unfundedSigner after execution
        const usdcAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );

        // check correct execution of signer side
        const totalUsdcDifferenceSigner = usdcBeforeSednSignerFirstNetwork.sub(usdcAfterSednSignerFirstNetwork);
        expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

        const claimerAuthToken = await createUserAndGenerateIdToken(
          auth,
          claimerPhone,
          sednVars[networksToTest[0]].recipient.address,
        );
        // build claim request and post to claim endpoint
        const claimRequest: IClaimRequest = {
          executionId: executionId,
          recipientIdOrAddress: sednVars[firstNetwork].recipient.address,
          // in real life, this can be also the claimants phone number
        };
        const claimResponse: IWireResponse = await apiCall(API_URL, "claim", claimRequest, claimerAuthToken);

        // get signatures
        const claimTransactions: ITransaction[] = claimResponse.transactions;
        const signedClaimTransactions: ITransaction[] = [];
        for (const claimTransaction of claimTransactions) {
          const claimSignedRequest = await handleTxSignature(claimTransaction, sednVars, "recipient");
          claimTransaction.signedTx = claimSignedRequest;
          signedClaimTransactions.push(claimTransaction);
        }

        // build execute api request
        const executeClaimTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedClaimTransactions,
          environment: ENVIRONMENT as Environment,
          type: claimResponse.type,
          recipientIdOrAddress: sednVars[firstNetwork].recipient.address,
        };

        // send signed transactions to API#
        const claimExecutionId = (
          await apiCall(API_URL, "executeTransactions", executeClaimTransactionsRequest, claimerAuthToken)
        ).id;
        console.log("INFO: executionIds", claimExecutionId);
        let claimExecution = await apiCall(
          API_URL,
          "executionStatus",
          { executionId: claimExecutionId },
          claimerAuthToken,
        );
        console.log("INFO: claimExecution", claimExecution);
        if (claimExecution.status !== "executed") {
          while (claimExecution.status !== "executed") {
            console.log("INFO: not executed, retrying", JSON.stringify(claimExecution));
            await sleep(10_000);
            claimExecution = await apiCall(
              API_URL,
              "executionStatus",
              { executionId: claimExecutionId },
              claimerAuthToken,
            );
          }
        }
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].recipient,
          sednBeforeSednRecipientFirstNetwork,
        );

        // establish previous sedn balances of recipient
        const sednAfterSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );

        // check correct execution of recipient side
        const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork.sub(
          sednBeforeSednRecipientFirstNetwork,
        );
        expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
        //networks and represents the complete send amount
      });
      it(`should be able to correctly sedn funds to an known user`, async function () {
        // partially randomized scenario creation
        console.log("INFO: Creating funding scenario");
        const firstNetwork = networksToTest[0];
        const scenarioNetwork: INetworkScenarios = {};
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from(sednVars[firstNetwork].amount),
          sedn: BigNumber.from("0"),
        };
        const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
        await instantiateFundingScenario(completeFundingScenario, sednVars);
        console.log("INFO: Done funding");

        // establish previous usdc balances of unfundedSigner
        const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );

        // establish previous sedn balances of recipient
        const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );

        // build request for API
        const wireRequest: IWireRequest = {
          senderAddress: sednVars[firstNetwork].unfundedSigner.address,
          recipientId: claimerPhone,
          amount: sednVars[firstNetwork].amount,
          testnet: testnet,
        };

        // send request to API
        const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, knownAuthToken);

        // get approve and signatures
        const transactions: ITransaction[] = wireResponse.transactions;
        const signedTransactions: ITransaction[] = [];
        for (const transaction of transactions) {
          const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
          transaction.signedTx = signedRequest;
          signedTransactions.push(transaction);
        }

        console.log("DEBUG: wireResponse.type:", wireResponse.type);

        // build api request
        const executeTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedTransactions,
          environment: ENVIRONMENT as Environment,
          type: wireResponse.type,
          recipientIdOrAddress: knownPhone,
        };
        // send signed transactions to API
        const executionId: IExecutionsResponse = (
          await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, knownAuthToken)
        ).id;
        console.log("INFO: executionIds", executionId);
        let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
        console.log("DEBUG: execution:", JSON.stringify(execution));
        if (execution.status !== "executed" && execution.status !== "failed") {
          while (execution.status !== "executed" && execution.status !== "failed") {
            console.log("INFO: not executed retrying for ID", executionId);
            await sleep(10_000);
            execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
          }
        }
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].recipient,
          sednBeforeSednRecipientFirstNetwork,
        );
        // establish usdc balances of unfundedSigner after execution
        const usdcAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );
        // check correct execution of signer side
        const totalUsdcDifferenceSigner = usdcBeforeSednSignerFirstNetwork.sub(usdcAfterSednSignerFirstNetwork);
        expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

        // establish previous sedn balances of recipient
        const sednAfterSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );
        // check correct execution of recipient side
        const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork.sub(
          sednBeforeSednRecipientFirstNetwork,
        );
        expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
        //networks and represents the complete send amount
      });
      it(`should be able to correctly transfer funds to an unknown user`, async function () {
        // partially randomized scenario creation
        console.log("INFO: Creating funding scenario");
        const firstNetwork = networksToTest[0];
        const scenarioNetwork: INetworkScenarios = {};
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: BigNumber.from(sednVars[firstNetwork].amount),
        };
        const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
        await instantiateFundingScenario(completeFundingScenario, sednVars);
        console.log("INFO: Done funding");

        // establish previous sedn balances of unfundedSigner
        const sednBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );

        // establish previous sedn balances of recipient
        const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );

        // build request for API
        const wireRequest: IWireRequest = {
          senderAddress: sednVars[firstNetwork].unfundedSigner.address,
          recipientId: unknownPhone,
          amount: sednVars[firstNetwork].amount,
          testnet: testnet,
        };

        // send request to API
        const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, knownAuthToken);

        // get approve and signatures
        const transactions: ITransaction[] = wireResponse.transactions;
        const signedTransactions: ITransaction[] = [];
        for (const transaction of transactions) {
          const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
          transaction.signedTx = signedRequest;
          signedTransactions.push(transaction);
        }

        // build api request
        const executeTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedTransactions,
          environment: ENVIRONMENT as Environment,
          type: wireResponse.type,
          recipientIdOrAddress: unknownPhone,
          memo: "sedn for transferUnknown",
        };
        // send signed transactions to API
        const executionId = (await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, knownAuthToken))
          .id;
        console.log("INFO: executionIds", executionId);
        let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
        console.log("DEBUG: execution:", JSON.stringify(execution));
        if (execution.status !== "executed" && execution.status !== "failed") {
          while (execution.status !== "executed" && execution.status !== "failed") {
            console.log("INFO: not executed retrying for ID", executionId);
            await sleep(10_000);
            execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
          }
        }
        // establish usdc balances of unfundedSigner after execution
        const sednAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );

        // check correct execution of signer side
        const totalSednDifferenceSigner = sednBeforeSednSignerFirstNetwork.sub(sednAfterSednSignerFirstNetwork);
        expect(totalSednDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

        const claimerAuthToken = await createUserAndGenerateIdToken(
          auth,
          claimerPhone,
          sednVars[networksToTest[0]].recipient.address,
        );
        // build claim request and post to claim endpoint
        const claimRequest: IClaimRequest = {
          executionId: executionId,
          recipientIdOrAddress: sednVars[firstNetwork].recipient.address,
          // in real life, this can be also the claimants phone number
        };
        const claimResponse: IWireResponse = await apiCall(API_URL, "claim", claimRequest, claimerAuthToken);

        // get signatures
        const claimTransactions: ITransaction[] = claimResponse.transactions;
        const signedClaimTransactions: ITransaction[] = [];
        for (const claimTransaction of claimTransactions) {
          const claimSignedRequest = await handleTxSignature(claimTransaction, sednVars, "recipient");
          claimTransaction.signedTx = claimSignedRequest;
          signedClaimTransactions.push(claimTransaction);
        }

        // build execute api request
        const executeClaimTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedClaimTransactions,
          environment: ENVIRONMENT as Environment,
          type: claimResponse.type,
          recipientIdOrAddress: sednVars[firstNetwork].recipient.address,
          memo: "claim for transfer",
        };
        // send signed transactions to API#
        const claimExecutionId = (
          await apiCall(API_URL, "executeTransactions", executeClaimTransactionsRequest, claimerAuthToken)
        ).id;
        console.log("INFO: executionIds", claimExecutionId);
        let claimExecution = await apiCall(
          API_URL,
          "executionStatus",
          { executionId: claimExecutionId },
          claimerAuthToken,
        );
        console.log("DEBUG: execution:", JSON.stringify(claimExecution));
        if (claimExecution.status !== "executed" && claimExecution.status !== "failed") {
          while (claimExecution.status !== "executed" && claimExecution.status !== "failed") {
            console.log("INFO: not executed retrying for ID", claimExecutionId);
            await sleep(10_000);
            claimExecution = await apiCall(
              API_URL,
              "executionStatus",
              { executionId: claimExecutionId },
              claimerAuthToken,
            );
          }
        }
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].recipient,
          sednBeforeSednRecipientFirstNetwork,
        );
        // establish previous sedn balances of recipient
        const sednAfterSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );
        // check correct execution of recipient side
        const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork.sub(
          sednBeforeSednRecipientFirstNetwork,
        );
        expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
        //networks and represents the complete send amount
      });
      it(`should be able to correctly transfer funds to an known user`, async function () {
        console.log("INFO: Creating funding scenario");
        const firstNetwork = networksToTest[0];
        const scenarioNetwork: INetworkScenarios = {};
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: BigNumber.from(sednVars[firstNetwork].amount),
        };
        const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
        await instantiateFundingScenario(completeFundingScenario, sednVars);
        console.log("INFO: Done funding");

        // establish previous sedn balances of unfundedSigner
        const sednBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );
        // establish previous sedn balances of recipient
        const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );

        // build request for API
        const wireRequest: IWireRequest = {
          senderAddress: sednVars[firstNetwork].unfundedSigner.address,
          recipientId: claimerPhone,
          amount: sednVars[firstNetwork].amount,
          testnet: testnet,
        };

        // send request to API
        const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, knownAuthToken);

        // get approve and signatures
        const transactions: ITransaction[] = wireResponse.transactions;
        const signedTransactions: ITransaction[] = [];
        for (const transaction of transactions) {
          const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
          transaction.signedTx = signedRequest;
          signedTransactions.push(transaction);
        }

        // build api request
        const executeTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedTransactions,
          environment: ENVIRONMENT as Environment,
          type: wireResponse.type,
          recipientIdOrAddress: claimerPhone,
          memo: "send to known user",
        };
        // send signed transactions to API
        const executionId: IExecutionsResponse = (
          await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, knownAuthToken)
        ).id;
        console.log("INFO: executionIds", executionId);
        let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
        console.log("DEBUG: execution:", JSON.stringify(execution));
        if (execution.status !== "executed" && execution.status !== "failed") {
          while (execution.status !== "executed" && execution.status !== "failed") {
            console.log("INFO: not executed retrying for ID", executionId);
            await sleep(10_000);
            execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
          }
        }
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].recipient,
          sednBeforeSednRecipientFirstNetwork,
        );

        // establish sedn balances of unfundedSigner after execution
        const sednAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );
        // check correct execution of signer side
        const totalUsdcDifferenceSigner = sednBeforeSednSignerFirstNetwork.sub(sednAfterSednSignerFirstNetwork);
        expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

        // establish previous sedn balances of recipient
        const sednAfterSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );
        // check correct execution of recipient side
        const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork.sub(
          sednBeforeSednRecipientFirstNetwork,
        );
        expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
        //networks and represents the complete send amount
      });
      it(`should be able to correctly sedn and transfer funds to an unknown user`, async function () {
        console.log("INFO: Creating funding scenario");
        const firstNetwork = networksToTest[0];
        const scenarioNetwork: INetworkScenarios = {};
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from(sednVars[firstNetwork].amount).div(2),
          sedn: BigNumber.from(sednVars[firstNetwork].amount).div(2),
        };
        const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
        await instantiateFundingScenario(completeFundingScenario, sednVars);
        console.log("INFO: Done funding");

        // establish previous usdc balances of unfundedSigner
        const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );
        // establish previous sedn balances of unfundedSigner
        const sednBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );
        // establish previous sedn balances of recipient
        const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );

        // build request for API
        const wireRequest: IWireRequest = {
          senderAddress: sednVars[firstNetwork].unfundedSigner.address,
          recipientId: unknownPhone,
          amount: sednVars[firstNetwork].amount,
          testnet: testnet,
        };

        // send request to API
        const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, knownAuthToken);

        // get approve and signatures
        const transactions: ITransaction[] = wireResponse.transactions;
        const signedTransactions: ITransaction[] = [];
        for (const transaction of transactions) {
          const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
          transaction.signedTx = signedRequest;
          signedTransactions.push(transaction);
        }

        // build api request
        const executeTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedTransactions,
          environment: ENVIRONMENT as Environment,
          type: wireResponse.type,
          recipientIdOrAddress: unknownPhone,
          memo: "send for hybrid to unknown",
        };
        // send signed transactions to API
        const executionId = (await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, knownAuthToken))
          .id;
        console.log("INFO: executionIds", executionId);
        let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
        console.log("DEBUG: execution:", JSON.stringify(execution));
        if (execution.status !== "executed" && execution.status !== "failed") {
          while (execution.status !== "executed" && execution.status !== "failed") {
            console.log("INFO: not executed retrying for ID", executionId);
            await sleep(10_000);
            execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
          }
        }

        // establish usdc balances of unfundedSigner after execution
        const usdcAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );
        // establish sedn balances of unfundedSigner after execution
        const sednAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );

        // check correct execution of signer side - usdc + sedn
        const totalDifferenceSigner = usdcBeforeSednSignerFirstNetwork
          .add(sednBeforeSednSignerFirstNetwork)
          .sub(usdcAfterSednSignerFirstNetwork.add(sednAfterSednSignerFirstNetwork));
        expect(totalDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

        const claimerAuthToken = await createUserAndGenerateIdToken(
          auth,
          claimerPhone,
          sednVars[networksToTest[0]].recipient.address,
        );
        // build claim request and post to claim endpoint
        const claimRequest: IClaimRequest = {
          executionId: executionId,
          recipientIdOrAddress: sednVars[firstNetwork].recipient.address,
          // in real life, this can be also the claimants phone number
        };
        const claimResponse: IWireResponse = await apiCall(API_URL, "claim", claimRequest, claimerAuthToken);

        // get signatures
        const claimTransactions: ITransaction[] = claimResponse.transactions;
        const signedClaimTransactions: ITransaction[] = [];
        for (const claimTransaction of claimTransactions) {
          const claimSignedRequest = await handleTxSignature(claimTransaction, sednVars, "recipient");
          claimTransaction.signedTx = claimSignedRequest;
          signedClaimTransactions.push(claimTransaction);
        }

        // build execute api request
        const executeClaimTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedClaimTransactions,
          environment: ENVIRONMENT as Environment,
          type: claimResponse.type,
          recipientIdOrAddress: sednVars[firstNetwork].recipient.address,
          memo: "claim for hybrid to unknown",
        };

        // send signed transactions to API#
        const claimExecutionId = (
          await apiCall(API_URL, "executeTransactions", executeClaimTransactionsRequest, claimerAuthToken)
        ).id;
        console.log("INFO: executionIds", claimExecutionId);
        let claimExecution = await apiCall(
          API_URL,
          "executionStatus",
          { executionId: claimExecutionId },
          claimerAuthToken,
        );
        console.log("DEBUG: execution:", JSON.stringify(claimExecution));
        if (claimExecution.status !== "executed" && claimExecution.status !== "failed") {
          while (claimExecution.status !== "executed" && claimExecution.status !== "failed") {
            console.log("INFO: not executed retrying for ID", claimExecutionId);
            await sleep(10_000);
            claimExecution = await apiCall(
              API_URL,
              "executionStatus",
              { executionId: claimExecutionId },
              claimerAuthToken,
            );
          }
        }
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].recipient,
          sednBeforeSednRecipientFirstNetwork,
        );
        // establish previous sedn balances of recipient
        const sednAfterSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );
        // check correct execution of recipient side
        const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork.sub(
          sednBeforeSednRecipientFirstNetwork,
        );
        expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
        //networks and represents the complete send amount
      });
      it(`should be able to correctly sedn and transfer funds to an known user`, async function () {
        console.log("INFO: Creating funding scenario");
        const firstNetwork = networksToTest[0];
        const scenarioNetwork: INetworkScenarios = {};
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from(sednVars[firstNetwork].amount).div(2),
          sedn: BigNumber.from(sednVars[firstNetwork].amount).div(2),
        };
        const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
        await instantiateFundingScenario(completeFundingScenario, sednVars);
        console.log("INFO: Done funding");

        // establish previous usdc balances of unfundedSigner
        const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );

        // establish previous sedn balances of unfundedSigner
        const sednBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );

        // establish previous sedn balances of recipient
        const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );

        // build request for API
        const wireRequest: IWireRequest = {
          senderAddress: sednVars[firstNetwork].unfundedSigner.address,
          recipientId: claimerPhone,
          amount: sednVars[firstNetwork].amount,
          testnet: testnet,
        };

        // send request to API
        const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, knownAuthToken);

        // get approve and signatures
        const transactions: ITransaction[] = wireResponse.transactions;
        const signedTransactions: ITransaction[] = [];
        for (const transaction of transactions) {
          const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
          transaction.signedTx = signedRequest;
          signedTransactions.push(transaction);
        }

        // build api request
        const executeTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedTransactions,
          environment: ENVIRONMENT as Environment,
          type: wireResponse.type,
          recipientIdOrAddress: unknownPhone,
          memo: "send for hybrid to known user",
        };
        // send signed transactions to API
        const executionId: IExecutionsResponse = (
          await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, knownAuthToken)
        ).id;
        console.log("INFO: executionIds", executionId);
        let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
        console.log("DEBUG: execution:", JSON.stringify(execution));
        if (execution.status !== "executed" && execution.status !== "failed") {
          while (execution.status !== "executed" && execution.status !== "failed") {
            console.log("INFO: not executed retrying for ID", executionId);
            await sleep(10_000);
            execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
          }
        }
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].recipient,
          sednBeforeSednRecipientFirstNetwork,
        );

        // establish usdc balances of unfundedSigner after execution
        const usdcAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );

        // establish sedn balances of unfundedSigner after execution
        const sednAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );

        // establish previous sedn balances of recipient
        const sednAfterSednRecipientFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
        );

        // check correct execution of signer side - usdc + sedn
        const totalDifferenceSigner = usdcBeforeSednSignerFirstNetwork
          .add(sednBeforeSednSignerFirstNetwork)
          .sub(usdcAfterSednSignerFirstNetwork.add(sednAfterSednSignerFirstNetwork));
        expect(totalDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

        // check correct execution of recipient side
        const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork.sub(
          sednBeforeSednRecipientFirstNetwork,
        );
        expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
        //networks and represents the complete send amount
      });
      it(`should be able to correctly withdraw funds`, async function () {
        // partially randomized scenario creation
        console.log("INFO: Creating funding scenario");
        const firstNetwork = networksToTest[0];
        const scenarioNetwork: INetworkScenarios = {};
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: BigNumber.from(sednVars[firstNetwork].amount),
        };
        const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
        await instantiateFundingScenario(completeFundingScenario, sednVars);
        console.log("INFO: Done funding");

        // establish previous usdc balances of unfundedSigner
        const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );

        // establish previous sedn balances of unfundedSigner
        const sednBeforeSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );

        // build request for withdraw API
        const withdrawRequest: IWithdrawRequest = {
          senderAddress: sednVars[firstNetwork].unfundedSigner.address,
          destinationAddress: sednVars[firstNetwork].unfundedSigner.address,
          destinationChainId: parseInt(getChainId(firstNetwork)) as ChainId, // specify deployedNetworks[2] as destination chain for bridgeWithdraw
          amount: sednVars[firstNetwork].amount,
          useStargate: false,
          environment: ENVIRONMENT as Environment,
          testnet: testnet,
        };

        // send request to API
        const withdrawResponse: ITransaction[] = await apiCall(API_URL, "withdraw", withdrawRequest, knownAuthToken);

        // get approve and signatures
        const transactions: ITransaction[] = withdrawResponse;
        const signedTransactions: ITransaction[] = [];
        for (let transaction of transactions) {
          if (testnet === true && transaction.type === "bridgeWithdraw") {
            transaction.chainId = parseInt(getChainId(deployedNetworks[2])); // since we specify first network as home chain
            // we can safely assume that the fake chainID (for socket purposes) is the second network
            console.log("INFO: chain ID corrected to", transaction.chainId);
          }
          const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
          transaction.signedTx = signedRequest;
          signedTransactions.push(transaction);
        }

        // build api request
        const executeTransactionsRequest: IExecuteTransactionsRequest = {
          transactions: signedTransactions,
          environment: ENVIRONMENT as Environment,
          type: "withdraw" as TransactionType,
          recipientIdOrAddress: knownPhone,
          memo: "withdraw test",
        };
        // send signed transactions to API
        const executionId: IExecutionsResponse = (
          await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, knownAuthToken)
        ).id;
        console.log("INFO: executionIds", executionId);
        let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
        console.log("DEBUG: execution:", JSON.stringify(execution));
        if (execution.status !== "executed" && execution.status !== "failed") {
          while (execution.status !== "executed" && execution.status !== "failed") {
            console.log("INFO: not executed retrying for ID", executionId);
            await sleep(10_000);
            execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, knownAuthToken);
          }
        }
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].recipient,
          sednBeforeSednSignerFirstNetwork,
        );

        // establish usdc balances of unfundedSigner after execution
        const usdcAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
        );
        // check correct execution of signer side
        const totalUsdcDifferenceSigner = usdcAfterSednSignerFirstNetwork.sub(usdcBeforeSednSignerFirstNetwork);
        const firstNetworkUsdcDifferenceSigner = usdcAfterSednSignerFirstNetwork.sub(usdcBeforeSednSignerFirstNetwork);
        if (testnet === true) {
          expect(totalUsdcDifferenceSigner.toString()).to.equal(sednVars[firstNetwork].amount.toString()); // amount is the same for all networks and represents the complete send amount
        } else {
          expect(totalUsdcDifferenceSigner).to.be.gt(firstNetworkUsdcDifferenceSigner.toNumber()); // should be more than the non-bridged amount
        }

        // establish previous sedn balances of recipient
        const sednAfterSednSignerFirstNetwork = BigNumber.from(
          await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
        );
        // check correct execution of recipient side
        const totalSednDifferenceSigner = sednBeforeSednSignerFirstNetwork.sub(sednAfterSednSignerFirstNetwork);
        expect(totalSednDifferenceSigner.toString()).to.equal(sednVars[firstNetwork].amount.toString()); // amount is the same for all
        //networks and represents the complete send amount
      });
    });
  });
});
