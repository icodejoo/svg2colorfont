// 演示消费:虚拟 CSS(注入 @font-face + class 规则)+ 类型安全的图标 API。
import 'virtual:colorfont.css'
// @ts-expect-error 虚拟模块,无静态类型(发布时由用户侧 d.ts/全局声明补)
import { codepoints, icons } from 'virtual:colorfont'

document.title = `colorfont: ${Object.keys(icons).length} icons`
console.log('codepoints', codepoints)
