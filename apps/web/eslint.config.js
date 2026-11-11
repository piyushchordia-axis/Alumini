import { reactConfig } from "@illuminize/config/eslint/react.js";
import noEmojiIcons from "@illuminize/config/eslint/no-emoji-icons.cjs";
import readableColours from "@illuminize/config/eslint/readable-colours.cjs";
export default [...reactConfig, noEmojiIcons, readableColours];
