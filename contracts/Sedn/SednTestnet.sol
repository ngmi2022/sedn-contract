// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.4;

import "./Sedn.sol";
import "../Forwarder/SednForwarder.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract SednTestnet is Sedn {
    constructor(
        address _usdcTokenAddressForChain,
        address _registryDeploymentAddressForChain,
        address _trustedVerifyAddress,
        SednForwarder _trustedForwarder
    ) Sedn(_usdcTokenAddressForChain, _registryDeploymentAddressForChain, _trustedVerifyAddress, _trustedForwarder) {
        console.log("This is a testnet deploy");
    }

    ///@inheritdoc ERC2771Context
    function _msgSender() internal view override(Sedn)
        returns (address sender) {
        sender = ERC2771Context._msgSender();
    }

    ///@inheritdoc ERC2771Context
    function _msgData() internal view override(Sedn)
        returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

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