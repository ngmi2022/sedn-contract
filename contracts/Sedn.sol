// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.4;

import "hardhat/console.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

error SednError();

contract Sedn is Ownable {
    IERC20 public usdcToken;

    constructor(address _usdcTokenAddressForChain) {
        console.log("Deploying the Sedn Contract; USDC Token Address:", _usdcTokenAddressForChain);
        usdcToken = IERC20(_usdcTokenAddressForChain);
    }

    function sednToUnregistered(uint _amount) public {
        console.log("Attempting to send", _amount);
        require(_amount > 0, "amount should be > 0");
        usdcToken.transferFrom(msg.sender, address(this), _amount);
    }
}
