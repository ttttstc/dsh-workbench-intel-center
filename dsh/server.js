/**
 * 智能信息情报中心的服务端入口。
 *
 * 这里只做插件声明：名字、注入的服务、配置 schema，然后挂上本机接口（见 routes.js）：
 *   GET  /api/intel-center/meta   数据目录与文件位置（面板生成复核提示词时要用真实路径）
 *   GET  /api/intel-center/state  读取全部卡片
 *   POST /api/intel-center/state  整份覆盖写入
 *
 * 不占用 Desktop 或其他插件的路径前缀；卸载工作台不会删除用户数据。
 */
import Schema from '@deepseek-ai/schemastery'
import { apply as mountRoutes } from './routes.js'

export const name = 'dsh-workbench-intel-center'
export const inject = ['connection']
export const Config = Schema.object({
  root: Schema.string().required()
})

export function apply(ctx, config) {
  mountRoutes(ctx, config, name)
}
