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

    event PreferredAddressSet(string phone, address to);

    struct Payment {
        address from;
        uint256 amount;
        bool completed;
    }

    // Mapping from token ID to owner address
    mapping(bytes32 => Payment) private payments;
    mapping(bytes32 => address) private preferredAddresses;

    constructor(address _usdcTokenAddressForChain, address _registryDeploymentAddressForChain) {
        console.log(
            "Deploying the Sedn Contract; USDC Token Address: %s; Socket Registry: %s",
            _usdcTokenAddressForChain,
            _registryDeploymentAddressForChain
        );
        usdcToken = IERC20(_usdcTokenAddressForChain);
        registry = IRegistry(_registryDeploymentAddressForChain);
        setAddressDelegate(msg.sender);
    }

    function sednToUnregistered(
        uint256 _amount,
        string calldata secret,
        string calldata nullifier
    ) public {
        console.log("Attempting to send", _amount);
        require(_amount > 0, "amount should be > 0");
        bytes32 key = keccak256(abi.encodePacked(secret, nullifier));
        require(payments[key].from == address(0), "nullifier already used");
        require(usdcToken.transferFrom(msg.sender, address(this), _amount), "transferFrom failed");
        payments[key] = Payment(msg.sender, _amount, false);
        paymentCounter++;
        console.log("Total payments", paymentCounter);
    }

    function sednToRegistered(
        uint256 _amount,
        string calldata secret,
        string calldata nullifier,
        string calldata phone
    ) public {
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

    function bridgeClaim(
        string calldata secret,
        string calldata nullifier,
        UserRequest calldata _userRequest,
        address bridgeImpl
    ) public {
        bytes32 key = keccak256(abi.encodePacked(secret, nullifier));
        require(payments[key].from != address(0), "payment not found");
        console.log("Bridge and claiming funds", payments[key].amount, msg.sender);
        usdcToken.approve(address(registry), payments[key].amount);
        usdcToken.approve(bridgeImpl, payments[key].amount);
        registry.outboundTransferTo(_userRequest);
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
