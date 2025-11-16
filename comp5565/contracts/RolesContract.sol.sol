// File: RolesContract.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 引入 OpenZeppelin 的 AccessControl 权限管理标准。
import "@openzeppelin/contracts/access/AccessControl.sol";
// 引入自定义的角色接口。
import "./I_Interfaces.sol";

// RolesContract 合约：负责定义、授予、撤销和查询业务角色身份。
contract RolesContract is AccessControl, IRolesContract {
    // 定义制造商角色的哈希值。
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    // 定义零售商角色的哈希值。
    bytes32 public constant RETAILER_ROLE = keccak256("RETAILER_ROLE");
    // 定义服务中心角色的哈希值。
    bytes32 public constant SERVICECENTER_ROLE = keccak256("SERVICECENTER_ROLE");

    // 构造函数：授予部署者 DEFAULT_ADMIN_ROLE（默认管理员权限）。
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // grantRole：授予账户特定角色的权限。仅限管理员调用。
    function grantRole(bytes32 role, address account) public virtual override onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(role, account);
    }
    
    // revokeRole：撤销账户特定角色的权限。仅限管理员调用。
    function revokeRole(bytes32 role, address account) public virtual override onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(role, account);
    }

    // isManufacturer：查询账户是否拥有制造商角色。
    function isManufacturer(address _account) external view override returns (bool) {
        return hasRole(MANUFACTURER_ROLE, _account);
    }

    // isRetailer：查询账户是否拥有零售商角色。
    function isRetailer(address _account) external view override returns (bool) {
        return hasRole(RETAILER_ROLE, _account);
    }

    // isServiceCenter：查询账户是否拥有服务中心角色。
    function isServiceCenter(address _account) external view override returns (bool) {
        return hasRole(SERVICECENTER_ROLE, _account);
    }
    
    // hasAnyRole：查询账户是否拥有任一业务角色（用于 ProductRegistry 的权限检查）。
    function hasAnyRole(address account) external view override returns (bool) {
        return 
            hasRole(MANUFACTURER_ROLE, account) ||
            hasRole(RETAILER_ROLE, account) ||
            hasRole(SERVICECENTER_ROLE, account);
    }
}