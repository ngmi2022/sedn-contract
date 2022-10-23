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
    address public addressDelegate;

    event PreferredAddressSet(string phone, address to);

    struct Payment {
        address from;
        uint amount;
        bool completed;
    }

    // Mapping from token ID to owner address
    mapping(bytes32 => Payment) private payments;
    mapping(bytes32 => address) private preferredAddresses;

    constructor(address _usdcTokenAddressForChain) {
        console.log("Deploying the Sedn Contract; USDC Token Address:", _usdcTokenAddressForChain);
        usdcToken = IERC20(_usdcTokenAddressForChain);
        setAddressDelegate(msg.sender);
    }

    function sednToUnregistered(uint _amount, string calldata secret, string calldata nullifier) public {
        console.log("Attempting to send", _amount);
        require(_amount > 0, "amount should be > 0");
        bytes32 key = keccak256(abi.encodePacked(secret, nullifier));
        require(payments[key].from == address(0), "nullifier already used");
        require(usdcToken.transferFrom(msg.sender, address(this), _amount), "transferFrom failed");
        payments[key] = Payment(msg.sender, _amount, false);
        paymentCounter++;
        console.log("Total payments", paymentCounter);
    }

    function sednToRegistered(uint _amount, string calldata secret, string calldata nullifier, string calldata phone) public {
        bytes32 _preferred = keccak256(abi.encodePacked(phone));
        require(preferredAddresses[_preferred] != address(0), "no preferred address found");
        address preferred = preferredAddresses[_preferred];
        console.log("Attempting to send", _amount);
        require(_amount > 0, "amount should be > 0");
        bytes32 key = keccak256(abi.encodePacked(secret, nullifier));
        require(payments[key].from == address(0), "nullifier already used");
        require(usdcToken.transferFrom(msg.sender, preferred, _amount), "transferFrom failed");
        payments[key] = Payment(msg.sender, _amount, true);
        paymentCounter++;
        console.log("Total payments", paymentCounter);
    }

    function claim(string calldata secret, string calldata nullifier) public {
        bytes32 key = keccak256(abi.encodePacked(secret, nullifier));
        require(payments[key].from != address(0), "payment not found");
        console.log("Claiming funds", payments[key].amount, msg.sender);
        usdcToken.approve(address(this), payments[key].amount);
        require(usdcToken.transferFrom(address(this), msg.sender, payments[key].amount), "transferFrom failed");
        payments[key].completed = true;
    }

    function setPreferredAddress(address to, string calldata phone) public {
        require(msg.sender == addressDelegate, "only address delegate may call this");
        bytes32 _preferred = keccak256(abi.encodePacked(phone));
        preferredAddresses[_preferred] = to;
        emit PreferredAddressSet(phone, to);
    }

    function setAddressDelegate(address delegate) public onlyOwner {
        addressDelegate = delegate;
    }
}
