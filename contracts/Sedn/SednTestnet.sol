// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.4;

import "./Sedn.sol";
import "../Forwarder/SednForwarder.sol";

contract SednTestnet is Sedn {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _trustedForwarder) Sedn(_trustedForwarder) {
        _disableInitializers();
    }
    function initialize(
        address _usdcTokenAddressForChain,
        address _registryDeploymentAddressForChain,
        address _trustedVerifyAddress,
        SednForwarder _trustedForwarder
    ) public initializer {
        Sedn.initSedn_unchained(
            _usdcTokenAddressForChain,
            _registryDeploymentAddressForChain,
            _trustedVerifyAddress,
            _trustedForwarder
            );
    }
    function bridgeWithdraw(
        uint256 amount,
        UserRequest calldata _userRequest,
        address bridgeImpl
    ) external override payable {
        address to = _userRequest.receiverAddress;
        require(_msgSender() != address(0), "bridgeWithdrawal from the zero address");
        require(to != address(0), "bridgeWithdrawal to the zero address");
        this.withdraw(amount, to);
    }
}