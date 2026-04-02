from passlib.context import CryptContext

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
password = '12345678'
print(f'密码: {password}')
print(f'字节长度: {len(password.encode("utf-8"))}')
try:
    hashed = pwd_context.hash(password)
    print(f'哈希成功: {hashed}')
except Exception as e:
    print(f'错误: {e}')
