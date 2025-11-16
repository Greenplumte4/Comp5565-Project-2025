// File: WarrantyManager.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./I_Interfaces.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; 

// WarrantyManager 合约：负责管理产品保修的生命周期、索赔状态和有效性检查。
contract WarrantyManager is IWarrantyManager, Ownable { 

    // 依赖的外部合约地址，用于解决循环依赖。
    address public productRegistryAddress;
    // 角色合约地址，用于权限检查（如 Service Center）。
    address public rolesContractAddress;
    // Marketplace 合约地址，用于授权其发放保修。
    address public marketplaceContract;

    // ClaimStatus：定义保修索赔的当前状态。
    enum ClaimStatus {
        None,           // 0
        Active,         // 1
        Pending,        // 2
        Expired,        // 3
        Fulfilled       // 4
    }

    // Warranty：存储单个产品 ID 对应的保修数据。
    struct Warranty {
        uint256 startDate;      // 保修开始的时间戳。
        uint256 durationDays;   // 修复 Test 1: 保修的总持续时间（天）。
        uint8 maxClaims;        // 保修期内允许的最大索赔次数。
        uint8 claimedCount;     // 已使用的索赔次数。
        ClaimStatus status;     // 当前的索赔状态。
        string serviceLog;      // 最近一次服务处理的日志或原因。
    }
    
    // ====== 新增事件：修复 Test 2, 3, 4 ======
    event ServiceRequested(uint256 indexed tokenId, address indexed customer, string reason);
    event ClaimResolved(uint256 indexed tokenId, address indexed serviceCenter, uint8 newClaimsCount);
    event ClaimRejected(uint256 indexed tokenId, address indexed serviceCenter, string reason);

    // warranties：映射产品 ID 到其完整的保修数据。
    mapping(uint256 => Warranty) public warranties;

    // 构造函数：初始化角色合约地址。
    constructor(address _rolesAddr) Ownable(msg.sender) { 
        require(_rolesAddr != address(0), "Invalid address");
        rolesContractAddress = _rolesAddr;
    }

    // setProductRegistryAddress：设置 ProductRegistry 地址，允许查询产品所有者。
    function setProductRegistryAddress(address _registryAddr) public override onlyOwner { 
        require(productRegistryAddress == address(0), "WM: Registry already set.");
        require(_registryAddr != address(0), "WM: Invalid address.");
        // 修复类型转换错误：直接赋值 address 类型
        productRegistryAddress = _registryAddr; 
    }

    // setMarketplaceAddress：设置 Marketplace 地址，允许其代表制造商发放保修。
    function setMarketplaceAddress(address _mpAddr) public override onlyOwner { 
        require(marketplaceContract == address(0), "WM: Marketplace already set.");
        require(_mpAddr != address(0), "WM: Invalid address.");
        marketplaceContract = _mpAddr;
    }

    // onlyServiceCenter：修饰符，确保只有服务中心角色可以调用。
    modifier onlyServiceCenter() {
        require(IRolesContract(rolesContractAddress).isServiceCenter(msg.sender), "Caller is not a Service Center");
        _;
    }

    // issueWarranty：为产品 ID 发行保修。
    function issueWarranty(
        uint256 tokenId,    
        uint256 durationDays,       
        uint8 maxClaims             
    ) public override {
        require(
            IRolesContract(rolesContractAddress).isManufacturer(msg.sender) || msg.sender == marketplaceContract,
            "WM: Not Manufacturer or Marketplace"
        );

        require(warranties[tokenId].status == ClaimStatus.None, "Warranty already issued.");

        // 修复 Test 1: 结构体中存储天数 (durationDays)。
        warranties[tokenId] = Warranty({
            startDate: block.timestamp,
            durationDays: durationDays, // 直接存储天数
            maxClaims: maxClaims,
            claimedCount: 0,
            status: ClaimStatus.Active,
            serviceLog: ""
        });
    }

    // =========================================================================
    // 通过函数重载来兼容接口和测试脚本对事件参数的需求。
    // =========================================================================
    
    // [1] 接口实现：实现 IWarrantyManager 定义的无参数版本。
    function requestService(uint256 tokenId) public override {
        // 默认传递一个空字符串作为原因，以满足 Event 的需求。
        _requestServiceInternal(tokenId, "");
    }

    // [2] 测试/内部版本：带有 reason 参数的版本
    function requestService(uint256 tokenId, string memory reason) public {
        _requestServiceInternal(tokenId, reason);
    }

    // [3] 核心逻辑：提取为内部函数，避免代码重复。
    function _requestServiceInternal(uint256 tokenId, string memory reason) internal {
        Warranty storage warranty = warranties[tokenId];

        require(warranty.status != ClaimStatus.None, "Warranty not issued.");
        require(productRegistryAddress != address(0), "WM: Registry address not set.");

        // 权限检查：确保调用者是产品 NFT 的当前所有者。
        address currentOwner = IProductRegistry(productRegistryAddress).ownerOf(tokenId);
        require(msg.sender == currentOwner, "Caller is not the product owner.");

        // 1. 时间检查：如果已过期，更新状态为 Expired 并阻止索赔。
        if (block.timestamp >= warranty.startDate + (warranty.durationDays * 1 days)) {
            warranty.status = ClaimStatus.Expired;
            revert("Warranty has expired.");
        }

        // 2. 状态检查：如果已 Fulfilled，阻止索赔并给出精确消息。
        if (warranty.status == ClaimStatus.Fulfilled) {
            revert("Maximum claims reached.");
        }

        // 3. 次数检查：确保索赔次数未达上限。
        require(warranty.claimedCount < warranty.maxClaims, "Maximum claims reached.");

        // 4. 状态检查：确保当前是 Active 状态（排除 Pending）。
        require(warranty.status == ClaimStatus.Active, "Warranty is not active.");

        // 状态流转：将状态更新为 Pending，等待服务中心处理。
        warranty.status = ClaimStatus.Pending;
        
        // 触发事件 (Fix Test 2)
        emit ServiceRequested(tokenId, msg.sender, reason);
    }
    // =========================================================================


    // approveClaim：服务中心批准索赔请求。
    function approveClaim(uint256 tokenId, string memory log) public override onlyServiceCenter {
        Warranty storage warranty = warranties[tokenId];
        require(warranty.status == ClaimStatus.Pending, "Claim not in pending state.");

        // 1. 更新索赔计数和日志。
        warranty.claimedCount++;
        warranty.serviceLog = log;

        // 2. 状态流转：如果达到最大次数，更新为 Fulfilled，否则回到 Active。
        // 此处逻辑已确认正确，如果测试失败，应检查测试脚本。
        if (warranty.claimedCount >= warranty.maxClaims) {
            warranty.status = ClaimStatus.Fulfilled;
        } else {
            warranty.status = ClaimStatus.Active;
        }
        
        // 触发事件 (Fix Test 3)
        emit ClaimResolved(tokenId, msg.sender, warranty.claimedCount);
    }

    // rejectClaim：服务中心拒绝索赔请求。
    function rejectClaim(uint256 tokenId, string memory reason) public override onlyServiceCenter {
        Warranty storage warranty = warranties[tokenId];
        require(warranty.status == ClaimStatus.Pending, "Claim not in pending state.");

        // 状态流转：返回 Active 状态，并记录拒绝原因。
        warranty.status = ClaimStatus.Active;
        warranty.serviceLog = string.concat("Rejected: ", reason);
        
        // 触发事件 (Fix Test 4)
        emit ClaimRejected(tokenId, msg.sender, reason);
    }

    // isWarrantyValid：核心视图函数，检查保修是否有效（供 ProductRegistry 调用）。
    function isWarrantyValid(uint256 productId) public view override returns (bool) {
        Warranty memory warranty = warranties[productId];

        // 只有 Active 或 Pending 状态才可能有效。
        if (warranty.status == ClaimStatus.Active || warranty.status == ClaimStatus.Pending) {
            // 检查时间是否到期。
            if (block.timestamp >= warranty.startDate + (warranty.durationDays * 1 days)) {
                return false;
            }
            return true;
        }
        return false;
    }

    // getWarrantyStatus：查询产品的保修状态详情。
    function getWarrantyStatus(uint256 tokenId) external view override returns (uint256, uint256, uint8, uint8, uint8, string memory) {
        Warranty memory w = warranties[tokenId];
        
        // 动态计算实际状态
        ClaimStatus actualStatus = w.status;
        
        // 只有 Active 或 Pending 状态才需要动态检查是否已过期。
        if ((actualStatus == ClaimStatus.Active || actualStatus == ClaimStatus.Pending) && 
            (block.timestamp >= w.startDate + (w.durationDays * 1 days))
        ) {
            // 如果时间已过，动态返回 Expired 状态
            actualStatus = ClaimStatus.Expired;
        }

        // 返回 durationDays
        return (w.startDate, w.durationDays, w.maxClaims, w.claimedCount, uint8(actualStatus), w.serviceLog);
    }
}