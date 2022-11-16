const polygonContracts = {
  MinimalForwarder: "0xc5babfd1c5FFdA1F24B1fC21453692d8d9678a87",
  sednContract: "0x579E9809C0E06711A815698ebCd38b210621760a",
}

export const forwarderAddressBook = {
  "polygon-mainnet": {
    MinimalForwarder: polygonContracts.MinimalForwarder,
    sednContract: polygonContracts.sednContract,
  },
  polygon: {
    MinimalForwarder: polygonContracts.MinimalForwarder,
    sednContract: polygonContracts.sednContract,
  },
  matic: {
    MinimalForwarder: polygonContracts.MinimalForwarder,
    sednContract: polygonContracts.sednContract,
  },
  gnosis: {
    MinimalForwarder: "0xB2819af7aAa8E7394D2303F2aB3C731c36072Fd3",
    sednContract: "TBD",
  },
  mainnet: {
    MinimalForwarder: "0x67c67a22d80466638a5d26Cd921Efb18F2C09b57",
    sednContract: "TBD",
  },
  arbitrum: {
    MinimalForwarder: "0x77183b55Ba34bF5A4da4D362085A68A67b78cCDA",
    sednContract: "0x8DC32778b81f7C2A537647CCf7fac2F8BC713f9C",
  }
};