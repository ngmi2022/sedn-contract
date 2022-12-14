// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.5;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SednUSDC
 * @dev Very simple ERC20 Token example, where all tokens are pre-assigned to the creator.
 * Note they can later distribute these tokens as they wish using `transfer` and other
 * `ERC20` functions.
 */
contract SednUSDC is ERC20 {
    /**
     * @dev Constructor that gives msg.sender all of existing tokens.
     */
    constructor (uint256 initialSupply) ERC20("testUSDC", "USDC") {
        _mint(msg.sender, initialSupply * (10 ** 6));
    }
        function decimals() override public pure returns (uint8) {
        return 6;
    }
}