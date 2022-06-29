import { ethers, hardhatArguments, upgrades } from "hardhat";
import fs from "fs";

export async function deployCookieHolder(args: any[]) {
  const owner = (await ethers.getSigners())[0];

  const CookieHolder = await ethers.getContractFactory("CookieHolder", owner);
  const deployedCookieHolder = await upgrades.deployProxy(CookieHolder, args);

  console.log(
    "CookieHolder deployed to: " +
    deployedCookieHolder.address +
    " by " +
    owner.address
  );
  fs.writeFileSync(
    "./build/cookieHolderProxyAddress-" + hardhatArguments.network + ".txt",
    deployedCookieHolder.address
  );
  return deployedCookieHolder;
}
