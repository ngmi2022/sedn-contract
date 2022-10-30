// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.4;

import "hardhat/console.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

error SednError();

interface IUserRequest {
    /**
    // @param id route id of middleware to be used
    // @param optionalNativeAmount is the amount of native asset that the route requires 
    // @param inputToken token address which will be swapped to
    // BridgeRequest inputToken 
    // @param data to be used by middleware
    */
    struct MiddlewareRequest {
        uint256 id;
        uint256 optionalNativeAmount;
        address inputToken;
        bytes data;
    }

    /**
    // @param id route id of bridge to be used
    // @param optionalNativeAmount optinal native amount, to be used
    // when bridge needs native token along with ERC20    
    // @param inputToken token addresss which will be bridged 
    // @param data bridgeData to be used by bridge
    */
    struct BridgeRequest {
        uint256 id;
        uint256 optionalNativeAmount;
        address inputToken;
        bytes data;
    }

    /**
    // @param receiverAddress Recipient address to recieve funds on destination chain
    // @param toChainId Destination ChainId
    // @param amount amount to be swapped if middlewareId is 0  it will be
    // the amount to be bridged
    // @param middlewareRequest middleware Requestdata
    // @param bridgeRequest bridge request data
    */
    struct UserRequest {
        address receiverAddress;
        uint256 toChainId;
        uint256 amount;
        MiddlewareRequest middlewareRequest;
        BridgeRequest bridgeRequest;
    }
}

interface IRegistry is IUserRequest {
    function outboundTransferTo(UserRequest calldata _userRequest) external payable;
}

contract Sedn is Ownable, IUserRequest {
    IERC20 public usdcToken;
    IRegistry public registry;
    uint256 public paymentCounter;
    address public addressDelegate;
    address public trustedVerifyAddress;
    uint256 public _till = 0;

    event PreferredAddressSet(string phone, address to);

    struct Payment {
        address from;
        uint256 amount;
        bool completed;
        bytes32 secret;
    }

    mapping(bytes32 => Payment) private payments;

    constructor(
        address _usdcTokenAddressForChain,
        address _registryDeploymentAddressForChain,
        address _trustedVerifyAddress
    ) {
        console.log(
            "Deploying the Sedn Contract; USDC Token Address: %s; Socket Registry: %s",
            _usdcTokenAddressForChain,
            _registryDeploymentAddressForChain
        );
        usdcToken = IERC20(_usdcTokenAddressForChain);
        registry = IRegistry(_registryDeploymentAddressForChain);
        trustedVerifyAddress = _trustedVerifyAddress;
    }

    function sedn(uint256 _amount, bytes32 memory secret) external {
        require(_amount > 0, "Amount must be greater than 0");
        require(bytes(secret).length > 0, "Secret must be greater than 0");
        require(usdcToken.transferFrom(msg.sender, address(this), _amount), "Transfer failed");
        require(payments[secret].secret != secret, "Can not double set secret");
        payments[secret] = Payment(msg.sender, _amount, false, secret);
    }

    function _checkClaim(
        string memory solution,
        bytes32 memory secret,
        address receiver,
        uint256 amount,
        uint256 till,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal {
        require(keccak256(abi.encodePacked(solution)) == payments[secret].secret, "Incorrect answer");
        require(payments[secret].secret == secret, "Secret not found");
        require(payments[secret].from != address(0), "payment not found");
        require(payments[secret].completed == false, "Payment already completed");
        require(payments[secret].amount == amount, "Amount does not match");
        require(block.timestamp < till, "Time expired");
        require(verify(amount, receiver, till, secret, nonce, _v, _r, _s), "Verification failed");
    }

    function claim(
        string memory solution,
        bytes32 memory secret,
        uint256 _till,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) public {
        _checkClaim(solution, secret, msg.sender, payments[secret].amount, _till, _v, _r, _s);
        usdcToken.approve(address(this), payments[key].amount);
        require(usdcToken.transferFrom(address(this), msg.sender, payments[key].amount), "transferFrom failed");
        payments[key].completed = true;
    }

    function bridgeClaim(
        string memory solution,
        bytes32 memory secret,
        uint256 _till,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        UserRequest calldata _userRequest,
        address bridgeImpl
    ) public {
        _checkClaim(solution, secret, msg.sender, payments[secret].amount, _till, _v, _r, _s);
        console.log("Bridge and claiming funds", payments[key].amount, msg.sender);
        usdcToken.approve(address(registry), payments[key].amount);
        usdcToken.approve(bridgeImpl, payments[key].amount);
        registry.outboundTransferTo(_userRequest);
        payments[key].completed = true;
    }

    function setVerifier(address _trustedVerifyAddress) public onlyOwner {
        trustedVerifyAddress = _trustedVerifyAddress;
    }

    function increaseNonce() public onlyOwner {
        nonce++;
    }

    function getMessageHash(
        uint256 _amount,
        address _receiver,
        uint256 _till,
        bytes32 _secret,
        uint256 _nonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_amount, _receiver, _till, _secret, _nonce));
    }

    function getEthSignedMessageHash(bytes32 _messageHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _messageHash));
    }

    function verify(
        uint256 _amount,
        address _receiver,
        uint256 _till,
        bytes32 _secret,
        uint256 _nonce,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) public pure returns (bool) {
        bytes32 messageHash = getMessageHash(_amount, _receiver, _till, _secret, _nonce);
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);
        return ecrecover(ethSignedMessageHash, v, r, s);
    }
}
