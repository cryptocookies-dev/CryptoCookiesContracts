/* eslint-disable camelcase */
// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.

import { deployCookieHolder } from "./common";
import { parseUnits } from "ethers/lib/utils";
import { hardhatArguments } from "hardhat";
import {
  USDC__factory,
  WBTC__factory,
  WETH__factory,
} from "../build/generated/sources/hardhat/main/typescript/factories/src/main/solidity/TestDependencies.sol";

const hre = require("hardhat");

const { ethers } = require("hardhat");

export async function deployTokensThenCookie() {
  console.info("Deploying tokens");
  const owner = (await ethers.getSigners())[0].address;

  const wethFactory: WETH__factory = await ethers.getContractFactory("WETH");
  const weth = await wethFactory.deploy();
  console.info("WETH deployed to " + weth.address);
  await weth.mint(owner, parseUnits("1000", 18));
  console.info("Minted 1000 WETH");

  const wbtcFactory: WBTC__factory = await ethers.getContractFactory("WBTC");
  const wbtc = await wbtcFactory.deploy();
  console.info("WBTC deployed to " + wbtc.address);
  await wbtc.mint(owner, parseUnits("1000", 8));
  console.info("Minted 1000 WBTC");

  const usdcFactory: USDC__factory = await ethers.getContractFactory("USDC");
  const usdc = await usdcFactory.deploy();
  console.info("USDC deployed to " + usdc.address);
  const amount = parseUnits("10000", 6);
  await usdc.mint(owner, amount);
  console.info("Minted 10000 USDC");

  const deployedCookieHolder = await deployCookieHolder([
    ["WETH", "WBTC", "USDC"],
    [weth.address, wbtc.address, usdc.address],
  ]);

  if (hardhatArguments.network === "ganache" && hre.ethernal) {
    await hre.ethernal.push({
      name: "CookieHolder",
      address: deployedCookieHolder.address,
    });
    console.log("Pushed contract info to Ethernal");
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
deployTokensThenCookie()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .then(() => {
    // eslint-disable-next-line
    process.exit(0);
  });
