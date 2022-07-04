import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-solhint";

import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import "solidity-coverage";
import "@openzeppelin/hardhat-upgrades";
import "@openzeppelin/hardhat-defender";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// import "@nomiclabs/hardhat-ganache";
// require("hardhat-ethernal");

const config: HardhatUserConfig = {
  paths: {
    artifacts: "./build/hardhat/artifacts",
    cache: "./build/hardhat/cache",
    sources: "./src/main/solidity",
    tests: "./src/test/typescript",
  },
  typechain: {
    outDir: "./build/generated/sources/hardhat/main/typescript",
  },
  solidity: {
    compilers: [
      {
        version: "0.8.13",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1337,
          },
        },
      },
      {
        version: "0.4.24",
      },
      {
        version: "0.6.12",
      },
    ],
  },
  defender: {
    apiKey: "3UeDCinxrVjNCLGAVxwzDCiLgKjJpC3E",
    apiSecret: process.env.DEFENDER_TEAM_API_SECRET_KEY ?? "<missing DEFENDER_TEAM_API_SECRET_KEY>",
  },
  networks: {
    bsc: {
      url: process.env.BINANCE_URL,
      chainId: 56,
      accounts: [process.env.BINANCE_KEY as string],
    },
    avalanche: {
      url: process.env.AVALANCE_URL,
      chainId: 43114,
      accounts: [process.env.AVALANCHE_KEY as string],
    },
    arbitrumtestnet: {
      url: process.env.ARBITRUM_URL,
      accounts: [process.env.ARBITRUM_TEST_KEY as string],
      chainId: 421611,
    },
    avalanchetestnet: {
      url: process.env.AVALANCHE_TEST_URL,
      accounts: [process.env.AVALANCHE_TEST_KEY as string],
      chainId: 43113,
    },
    goerli: {
      url: process.env.GOERLI_URL,
      accounts: [process.env.GOERLI_KEY as string],
      chainId: 5,
    },
    binancetestnet: {
      url: process.env.BINANCE_TEST_URL,
      accounts: [process.env.BINANCE_TEST_KEY as string],
      chainId: 97,
    },
    ganache: {
      url: "http://127.0.0.1:8546",
      chainId: 1337,
    },
    hardhat: {
      mining: {
        auto: true,
      },
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    coinmarketcap: "fcca5f60-2686-4b49-be0c-14a9340d825c",
    src: "./src/main/solidity",
    token: "BNB",
    excludeContracts: [
      "ERC20PresetFixedSupply",
      "ERC20PresetMinterPauser",
      "ERC20",
      "USDC",
      "WETH",
      "WBTC",
    ],
  },
  etherscan: {
    apiKey: {
      avalanche: process.env.SNOWTRACE_API_KEY ?? "",
      bsc: process.env.BSCSCAN_API_KEY ?? "",
    },
  },
  contractSizer: {
    runOnCompile: true,
    strict: true,
    only: ["CookieHolder"],
  },
};

export default config;
