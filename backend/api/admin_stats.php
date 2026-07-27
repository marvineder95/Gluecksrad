<?php
require_once __DIR__ . '/../config/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($method !== 'GET') {
    jsonResponse(['error' => 'Methode nicht erlaubt'], 405);
}

requireSuperAdmin();

$totalCustomers = intval($db->query("SELECT COUNT(*) FROM customers")->fetchColumn());
$activeCustomers = intval($db->query("SELECT COUNT(*) FROM customers WHERE is_active = 1")->fetchColumn());

$totalUsers = intval($db->query("SELECT COUNT(*) FROM users")->fetchColumn());
$activeUsers = intval($db->query("SELECT COUNT(*) FROM users WHERE is_active = 1")->fetchColumn());
$inactiveUsers = $totalUsers - $activeUsers;

$superAdmins = intval($db->query("SELECT COUNT(*) FROM users WHERE role = 'super_admin'")->fetchColumn());
$customerAdmins = intval($db->query("SELECT COUNT(*) FROM users WHERE role = 'customer_admin'")->fetchColumn());

$totalSpins = intval($db->query("SELECT COUNT(*) FROM spins")->fetchColumn());

jsonResponse([
    'total_customers' => $totalCustomers,
    'active_customers' => $activeCustomers,
    'inactive_customers' => $totalCustomers - $activeCustomers,
    'total_users' => $totalUsers,
    'active_users' => $activeUsers,
    'inactive_users' => $inactiveUsers,
    'super_admins' => $superAdmins,
    'customer_admins' => $customerAdmins,
    'total_spins' => $totalSpins
]);
