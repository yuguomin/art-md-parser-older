import recast from "recast";
import { readFileSync, appendFile, appendFileSync } from "fs";
const tsParser = require("recast/parsers/typescript");
const marked = require("marked");

const interfaceAst = require("./ast/TSExample/exportInterfaceAst");

const isCutOut = require("./art.config").isCutOut;

enum TypeAnnotations {
  int = "TSNumberKeyword",
  string = "TSStringKeyword",
  boolean = "TSBooleanKeyword",
  array = "TSArrayType"
}

// first: get md ast
const md = readFileSync("./test.md", "UTF8");
const tokens = marked.lexer(md);

// second: md ast change into typescript ast and format to interface.ts
const extractAllInterfaceChunk = (mdAst): never[] => {
  // extract every interface detail and explain add to an Object and push an Array
  const interfaceGather = [];
  let chunkStart = 0;
  mdAst.forEach((value, index) => {
    if (value.type === "list_start" && index) {
      const chunkData = mdAst.slice(chunkStart, index);
      interfaceGather.push(extractUseTables(
        ["detail", "explain"],
        chunkData
      ) as never);
    }
    if (value.type === "list_start") {
      chunkStart = index;
    }
    if (index === mdAst.length - 1) {
      const chunkData = mdAst.slice(chunkStart, index);
      interfaceGather.push(extractUseTables(
        ["detail", "explain"],
        chunkData
      ) as never);
    }
  });
  return interfaceGather;
};

const extractUseTables = (findTableType: string[], chunkData: any[]) => {
  const userTables = {};
  findTableType.forEach(v => {
    userTables[v] = extractChooseTable(v, chunkData);
  });
  return userTables;
};

const extractChooseTable = (tableText: string, chunkData: any[]) => {
  let result = {};
  chunkData.forEach((value, index) => {
    // confirm right table chunk
    if (
      value.type === "heading" &&
      value.depth === 4 &&
      value.text === tableText
    ) {
      result =
        chunkData.find((tableValue, tableIndex) => {
          if (tableIndex > index && tableValue.type === "table") {
            return tableValue;
          }
        }) || {};
    }
  });
  return result;
};

// 生成最终的一个interface名字
const createInterfaceName = (detailTable: any) => {
  let resultStr: string = "";
  let urlStr: string = "";
  const tableCells = flattenArray(detailTable.cells);
  tableCells.find((value, index) => {
    if (value === "request-url") {
      urlStr = tableCells[index + 1];
    }
  });
  urlStr = isCutOut ? urlStr.replace(/\/\w+/, "") : urlStr;
  resultStr =
    "I" +
    urlStr.replace(/\/(\w)/g, (all, letter) => {
      return letter.toUpperCase();
    });
  return resultStr;
};

// 生成interface的body部分
const createInterfaceBody = (explainTable: any, currentParent) => {
  // 获取对应的参数名，类型，说明，parents, 示例的index
  // console.log(explainTable);
  const [
    nameIndex,
    typeIndex,
    explainIndex,
    parentsIndex,
    exampleIndex
  ] = findAllIndex(
    ["参数名", "类型", "说明", "parents", "示例"],
    explainTable.header
  );
  const result = [];
  explainTable.cells.forEach(value => {
    if (value[parentsIndex] === currentParent) {
      const bodyTemplate = objDeepCopy(
        interfaceAst.ExportInterfaceAst.body.body[0]
      ) as any;
      bodyTemplate.key.name = value[nameIndex];
      // bodyTemplate.typeAnnotation.typeAnnotation.type = TypeAnnotations[value[typeIndex]];
      bodyTemplate.typeAnnotation = getTypeAnnotation(value[typeIndex], value[nameIndex]);
      result.push(bodyTemplate as never);
    };
    // TODO: add createChildrenInterface and differentiate every parents
    if (value[parentsIndex] === currentParent && ['array', 'object'].includes(value[typeIndex])) {
      const childrenChunk = {} as any;
      childrenChunk.header = explainTable.header;
      childrenChunk.cells = explainTable.cells.filter(cell => cell[parentsIndex] === value[nameIndex]);
      createChildrenInterface(value, childrenChunk, value[nameIndex]);
    };
  });
  return result;
};

// 当前的一个interface命名保存数组

/** 
 * 当父节点不为data && 其类型为array或者object时需要创建一个interface
 * 当需要创建的时候可以把其他父节点为其值的创建body
 */
const createChildrenInterface = (singleCell, childrenBody, parentName) => {
  appendInterfaceTofile(parentName, createInterfaceBody(childrenBody, parentName))
}

const getTypeAnnotation = (type, name) => {
  const anntationTpl = objDeepCopy(interfaceAst.ExportInterfaceAst.body.body[0].typeAnnotation) as any;
  anntationTpl.typeAnnotation.type = TypeAnnotations[type];
  if (type === 'array') {
    anntationTpl.typeAnnotation.elementType.typeName.name = name;
    // console.log(JSON.stringify(anntationTpl))
  }
  return anntationTpl;
}

// third: parse to interface.ts
const replaceTsAst = () => {
  let result = [];
  const interfaceGather = extractAllInterfaceChunk(tokens);
  interfaceGather.forEach((value, index) => {
    /**
     * body.body是一个数组，每一个索引值就是一个annotation,其中的key.name为属性，typeAnnotation.typeAnnotation.type为类型
     * 此处需要处理就是在每一个属性table中找到对应的每一个返回参数，分别加入body中，然后最终append
     */
    const interfaceName = createInterfaceName((<any>value).detail);
    const interfaceBody = createInterfaceBody((<any>value).explain, 'data');
    appendInterfaceTofile(interfaceName, interfaceBody);
  });
};

const appendInterfaceTofile = (interfaceName, interfaceBody) => {
  const singleChunk = objDeepCopy(interfaceAst) as any;
  singleChunk.ExportInterfaceAst.id.name = interfaceName;
  singleChunk.ExportInterfaceAst.body.body = interfaceBody;
  appendFileSync(
    "./result/test.ts",
    `\n${recast.print(singleChunk.ExportInterfaceAst as never).code}`,
    "utf8"
  );
}


const objDeepCopy = source => {
  var sourceCopy = source instanceof Array ? [] : {};
  for (var item in source) {
    sourceCopy[item] =
      typeof source[item] === "object"
        ? objDeepCopy(source[item])
        : source[item];
  }
  return sourceCopy;
};

const flattenArray = arr => {
  return arr.reduce((prev, next) => {
    return prev.concat(Array.isArray(next) ? flattenArray(next) : next);
  }, []);
};

const findAllIndex = (findArr, TargetArr) => {
  const indexGather = [];
  findArr.forEach(value => {
    indexGather.push(TargetArr.indexOf(value) as never);
  });
  return indexGather;
};

replaceTsAst();
