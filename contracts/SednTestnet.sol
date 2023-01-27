// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.4;

import "./Sedn.sol";

contract SednTestnet is Sedn {
    constructor(
        address _usdcTokenAddressForChain,
        address _registryDeploymentAddressForChain,
        address _trustedVerifyAddress,
        MinimalForwarder _trustedForwarder
    ) Sedn(_usdcTokenAddressForChain, _registryDeploymentAddressForChain, _trustedVerifyAddress, _trustedForwarder) {
        console.log("This is a testnet deploy");
    }

    function bridgeWithdraw(
        uint256 amount,
        UserRequest calldata _userRequest,
        address bridgeImpl
    ) external override payable {
        address from = _msgSender();
        address to = _userRequest.receiverAddress;
        require(from != address(0), "bridgeWithdrawal from the zero address");
        require(to != address(0), "bridgeWithdrawal to the zero address");
        console.log("Bridge and claiming funds (from, amount, to):",  from, amount, to);
        console.log("UserRequest", _userRequest.amount, _userRequest.receiverAddress, _userRequest.toChainId);
        console.log("BridgeImpl", bridgeImpl);
        this.withdraw(amount, to);
    }
}