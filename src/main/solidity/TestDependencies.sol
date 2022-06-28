// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.13;

// Used in hardhat tests
import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetFixedSupply.sol";

// Deployed to local test nodes
import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";

contract WETH is ERC20PresetMinterPauser("Wrapped ETH", "WETH") {}

contract WBTC is ERC20PresetMinterPauser("Wrapped BTC", "WBTC") {
    function decimals() public view virtual override returns (uint8) {
        return 8;
    }
}

contract USDC is ERC20PresetMinterPauser("USD Coin", "USDC") {
    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
}
