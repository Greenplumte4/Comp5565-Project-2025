// File: I_Interfaces.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 角色管理接口
interface IRolesContract {
    // 检查地址是否为制造商。
    function isManufacturer(address _account) external view returns (bool);
    // 检查地址是否为零售商。
    function isRetailer(address _account) external view returns (bool);
    // 检查地址是否为服务中心。
    function isServiceCenter(address _account) external view returns (bool);
    // 检查地址是否拥有任一已定义的角色。
    function hasAnyRole(address account) external view returns (bool);
}

// 产品注册接口 (NFT)
interface IProductRegistry {
    // 铸造一个新的产品 NFT，记录其核心信息。
    function mintProduct(
        address to, 
        string memory serialNumber, 
        string memory modelDetails, 
        string memory manufacturerDetails, 
        uint256 price, 
        string memory warrantyTermsURI
    ) external returns (uint256 tokenId);

    // 更新产品的价格和上架状态。
    function updateMarketInfo(uint256 productId, uint256 price, bool isListed) external;
    // 记录产品所有权转移的业务事件。
    function recordOwnershipTransfer(uint256 productId, address from, address to, string memory eventType) external;
    // 查询产品 NFT 的当前所有者。
    function ownerOf(uint256 tokenId) external view returns (address);
    // 设置授权的 Marketplace 合约地址。
    function setMarketplaceAddress(address _marketplaceAddress) external;
    
    // 标准 ERC-721 转账函数。
    function transferFrom(address from, address to, uint256 tokenId) external;
    // 供授权的 Marketplace 调用的受限转账函数。
    function restrictedTransferFrom(address from, address to, uint256 tokenId) external;
}

// 保修管理接口
interface IWarrantyManager {
    // 为指定产品发行保修，设置有效天数和最大索赔次数。
    function issueWarranty(uint256 tokenId, uint256 durationDays, uint8 maxClaims) external;
    // 检查产品保修是否仍有效。
    function isWarrantyValid(uint256 productId) external view returns (bool);
    // 产品所有者发起服务请求（索赔）。
    function requestService(uint256 tokenId) external;
    // 服务中心批准索赔，并记录服务日志。
    function approveClaim(uint256 tokenId, string memory log) external;
    // 服务中心拒绝索赔。
    function rejectClaim(uint256 tokenId, string memory reason) external;
    // 设置关联的 ProductRegistry 合约地址。
    function setProductRegistryAddress(address _registryAddr) external;
    // 设置关联的 Marketplace 合约地址。
    function setMarketplaceAddress(address _mpAddr) external;
    
    // 获取产品的保修状态详情。
    function getWarrantyStatus(uint256 tokenId) external view returns (uint256, uint256, uint8, uint8, uint8, string memory);
}