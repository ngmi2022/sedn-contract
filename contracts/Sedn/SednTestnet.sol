// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.4;

import "./Sedn.sol";
import "../Forwarder/SednForwarder.sol";

contract SednTestnet is Sedn {
    constructor(address _trustedForwarder) Sedn(_trustedForwarder) {}
    function bridgeWithdraw(
        uint256 amount,
        UserRequest calldata _userRequest,
        address bridgeImpl
    ) external override payable {
        address to = _userRequest.receiverAddress;
        require(_msgSender() != address(0), "bridgeWithdrawal from the zero address");
        require(to != address(0), "bridgeWithdrawal to the zero address");
        console.log("Bridge and claiming funds (from, amount, to):",  _msgSender(), amount, to);
        console.log("UserRequest", _userRequest.amount, _userRequest.receiverAddress, _userRequest.toChainId);
        console.log("BridgeImpl", bridgeImpl);
        this.withdraw(amount, to);
    }
}