const { ApolloServer } = require("@apollo/server");
const { startStandaloneServer } = require("@apollo/server/standalone");
const connectDB = require("./db");
const Book = require("./models/Book");
const Author = require("./models/Author");
const User = require("./models/User");
const { GraphQLError } = require("graphql");
require("dotenv").config();

connectDB();

const typeDefs = `
    type Author {
        name: String!
        id: ID!
        born: Int
        bookCount: Int
    }

    type Book {
        title: String!
        published: Int!
        author: Author!
        id: ID!
        genres: [String!]!
    }

    type Query {
        bookCount: Int!
        authorCount: Int!
        allBooks(author: String, genre: String): [Book!]!
        allAuthors: [Author!]!
    }

    type Mutation {
        addBook(
            title: String!
            author: String!
            published: Int!
            genres: [String!]!
        ): Book

        editAuthor(name: String!, setBornTo: Int!): Author
    }
`;

// Resolvers
const resolvers = {
    Query: {
        bookCount: async () => Book.countDocuments(),
        authorCount: async () => Author.countDocuments(),
        allBooks: async (root, args) => {
            let query = {};

            if (args.author) {
                const author = await Author.findOne({ name: args.author });
                if (author) {
                    query.author = author._id;
                }
            }
            if (args.genre) {
                query.genres = { $in: [args.genre] };
            }

            return Book.find(query).populate("author");
        },
        allAuthors: async () => Author.find({}),
    },
    Author: {
        bookCount: async (root) => Book.countDocuments({ author: root._id }),
    },
    Mutation: {
        addBook: async (root, args) => {
            try {
                let author = await Author.findOne({ name: args.author });

                if (!author) {
                    author = new Author({ name: args.author });
                    await author.save();
                }

                const newBook = new Book({
                    title: args.title,
                    published: args.published,
                    author: author._id,
                    genres: args.genres,
                });

                await newBook.save();
                return newBook.populate("author");
            } catch (error) {
                throw new GraphQLError("Error al agregar el libro: " + error.message, {
                    extensions: {
                        code: "BAD_USER_INPUT",
                    },
                });
            }
        },

        editAuthor: async (root, args) => {
            try {
                const author = await Author.findOne({ name: args.name });
                if (!author) {
                    throw new GraphQLError("El autor no existe", {
                        extensions: {
                            code: "NOT_FOUND",
                        },
                    });
                }

                author.born = args.setBornTo;
                await author.save();
                return author;
            } catch (error) {
                throw new GraphQLError("Error al editar el autor: " + error.message, {
                    extensions: {
                        code: "BAD_USER_INPUT",
                    },
                });
            }
        },
    },
};

// Create the Apollo server
const server = new ApolloServer({
    typeDefs,
    resolvers,
});

// Init the server
startStandaloneServer(server, {
    listen: { port: 4000 },
}).then(({ url }) => {
    console.log(`Server ready at ${url}`);
});
