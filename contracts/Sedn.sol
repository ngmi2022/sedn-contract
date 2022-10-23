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
    uint256 public paymentCounter;

    struct Payment {
        address from;
        uint amount;
    }

    // Mapping from token ID to owner address
    mapping(bytes32 => Payment) private payments;

    constructor(address _usdcTokenAddressForChain) {
        console.log("Deploying the Sedn Contract; USDC Token Address:", _usdcTokenAddressForChain);
        usdcToken = IERC20(_usdcTokenAddressForChain);
    }

    function sednToUnregistered(uint _amount, string calldata secret, string calldata nullifier) public {
        console.log("Attempting to send", _amount);
        require(_amount > 0, "amount should be > 0");
        bytes32 key = keccak256(abi.encodePacked(secret, nullifier));
        //require(payments[nullifier].from == address(0), "nullifier already used");
        require(usdcToken.transferFrom(msg.sender, address(this), _amount), "transferFrom failed");
        payments[key] = Payment(msg.sender, _amount);
        paymentCounter++;
        console.log("Total payments", paymentCounter);
    }
}
