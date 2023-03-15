// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.4;

import "./Sedn.sol";
import "../Forwarder/SednForwarder.sol";

contract SednTestnetLatest is SednLatest {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _trustedForwarder) SednLatest(_trustedForwarder) {
        _disableInitializers();
    }
    function initialize(
        address _usdcTokenAddressForChain,
        address _registryDeploymentAddressForChain,
        address _trustedVerifyAddress,
        SednForwarder _trustedForwarder
    ) public initializer {
        SednLatest.initSedn_unchained(
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
        usdcToken.approve(address(this), amount);
        require(usdcToken.transferFrom(address(this), to, amount), "transferFrom failed");
        _burn(_msgSender(), amount);
        emit Withdraw(_msgSender(), to, amount);
    }
}